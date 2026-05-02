/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const APP_ID = process.env.AGORA_APP_ID!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;
const auth = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString(
  "base64",
);

// ─── Agora region code → AWS region string mapping ──────────────────────────
// Agora uses numeric codes, AWS uses region strings for S3 URLs.
const AGORA_REGION_TO_AWS: Record<number, string> = {
  0: "us-east-1",       // US East (N. Virginia)
  1: "us-west-2",       // US West (Oregon)
  2: "eu-west-1",       // EU (Ireland)
  3: "ap-southeast-1",  // Asia Pacific (Singapore)
  4: "ap-northeast-1",  // Asia Pacific (Tokyo)
  5: "ap-southeast-2",  // Asia Pacific (Sydney)  — Agora custom mapping
  6: "ap-northeast-1",  // Asia Pacific (Tokyo)   — alias
  7: "ap-south-1",      // Asia Pacific (Mumbai)
  8: "eu-central-1",    // EU (Frankfurt)
  9: "us-east-2",       // US East (Ohio)
  10: "us-west-1",      // US West (N. California)
  11: "ap-northeast-2", // Asia Pacific (Seoul)
  15: "me-south-1",     // Middle East (Bahrain)
  17: "eu-west-2",      // EU (London)
};

/**
 * Construct the S3 URL for a recorded file.
 *
 * Agora Cloud Recording (mix mode) generates MP4 files named:
 *   <sid>_<channelName>.mp4
 *
 * These are placed under the fileNamePrefix configured in storageConfig:
 *   ["recordings", channelName]
 *
 * So the full path is:
 *   recordings/<channelName>/<sid>_<channelName>.mp4
 */
function buildRecordingUrls(
  sid: string,
  channelName: string,
  fileListFromAgora?: string[],
) {
  const bucket = process.env.AWS_STORAGE_BUCKET_NAME;
  const regionCode = Number(process.env.AWS_S3_REGION_CODE || 0);
  const awsRegion = AGORA_REGION_TO_AWS[regionCode] || "us-east-1";

  // Agora replaces special characters in channel names with hyphens in filenames
  const safeChannelName = channelName.replace(/[^a-zA-Z0-9_-]/g, "-");

  const baseUrl = `https://${bucket}.s3.${awsRegion}.amazonaws.com`;
  const prefix = `recordings/${channelName}`;

  // If Agora returned actual file names, use those
  if (fileListFromAgora && fileListFromAgora.length > 0) {
    const mp4Files = fileListFromAgora.filter((f: string) =>
      f.endsWith(".mp4"),
    );
    const m3u8Files = fileListFromAgora.filter((f: string) =>
      f.endsWith(".m3u8"),
    );
    return {
      mp4: mp4Files.map((f: string) => `${baseUrl}/${prefix}/${f}`),
      m3u8: m3u8Files.map((f: string) => `${baseUrl}/${prefix}/${f}`),
      allFiles: fileListFromAgora.map(
        (f: string) => `${baseUrl}/${prefix}/${f}`,
      ),
      // Primary URL — first MP4 file
      recordingUrl:
        mp4Files.length > 0
          ? `${baseUrl}/${prefix}/${mp4Files[0]}`
          : `${baseUrl}/${prefix}/${fileListFromAgora[0]}`,
    };
  }

  // Construct predicted URLs from known naming pattern
  const mp4FileName = `${sid}_${safeChannelName}.mp4`;
  const m3u8FileName = `${sid}_${safeChannelName}.m3u8`;

  return {
    mp4: [`${baseUrl}/${prefix}/${mp4FileName}`],
    m3u8: [`${baseUrl}/${prefix}/${m3u8FileName}`],
    allFiles: [
      `${baseUrl}/${prefix}/${mp4FileName}`,
      `${baseUrl}/${prefix}/${m3u8FileName}`,
    ],
    // Primary URL — the MP4 file
    recordingUrl: `${baseUrl}/${prefix}/${mp4FileName}`,
  };
}

// Helper to poll recording status until upload completes
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pollS3UploadStatus = async (
  resourceId: string,
  sid: string,
  maxRetries: number = 5,
) => {
  let uploadComplete = false;
  let fileList: any = [];
  let finalStatus = "backuped";

  for (let i = 0; i < maxRetries; i++) {
    try {
      const queryRes = await axios.get(
        `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/query`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
          },
        },
      );

      const response = queryRes.data;
      console.log(
        `[Poll ${i + 1}/${maxRetries}] Status:`,
        response?.serverResponse?.uploadingStatus,
      );

      if (response?.serverResponse) {
        const { uploadingStatus, fileList: files } = response.serverResponse;
        finalStatus = uploadingStatus || "backuped";

        // Check if upload is complete
        if (uploadingStatus === "uploaded" || uploadingStatus === "backuped") {
          fileList = files || [];
          uploadComplete = true;
          console.log("✅ S3 Upload Status:", uploadingStatus);
          console.log("📁 Files uploaded:", fileList);
          break;
        }
      }
    } catch (err: any) {
      // After stopping, the resource becomes invalid (404 is expected)
      if (err?.response?.status === 404) {
        console.log(
          `⏹️ Recording resource released after stop (404 is normal). Upload in progress.`,
        );
        // After stop, resource is gone but files are queued for upload
        uploadComplete = true;
        break;
      }
      console.warn(`Poll attempt ${i + 1} failed:`, err.message);
    }

    // Wait before next attempt (short delays)
    if (i < maxRetries - 1 && !uploadComplete) {
      await sleep(500 + i * 300); // 500ms, 800ms, 1.1s, etc.
    }
  }

  return { uploadComplete, fileList, finalStatus };
};

export async function POST(req: NextRequest) {
  const { channelName, resourceId, sid, recordingUid } = await req.json();
  const RECORDING_UID = recordingUid || "123456789"; // fallback for old sessions
  console.log("🛑 Stop recording:", {
    channelName,
    resourceId,
    sid,
    RECORDING_UID,
  });

  if (!channelName || !resourceId || !sid) {
    return NextResponse.json(
      { error: "channelName, resourceId, and sid are required" },
      { status: 400 },
    );
  }

  // ── DEMO_MODE: return mock success without calling Agora ──
  // The start API also runs in demo mode and returns a fake resourceId/sid.
  // Calling Agora's real stop endpoint with a fake resourceId causes error code 2.
  const demoMode = process.env.DEMO_MODE === "true";
  if (demoMode || resourceId.startsWith("demo-")) {
    console.log("ℹ️  DEMO_MODE: returning mock stop response");
    const demoUrls = buildRecordingUrls(sid, channelName);
    return NextResponse.json({
      success: true,
      message: "Demo recording stopped (not actually recording to S3)",
      recordingUrl: demoUrls.recordingUrl,
      recordingUrls: demoUrls,
      s3Upload: {
        status: "demo",
        files: [],
        note: "Demo mode — no real recording was made. URLs are predicted format.",
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // STEP 1: Stop recording (async_stop: true = return immediately)
    console.log("⏸️ Sending stop request to Agora...");
    const stopRes = await axios.post(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
      {
        cname: channelName,
        uid: RECORDING_UID,
        clientRequest: {
          async_stop: true, // TRUE = return immediately, don't wait for processing
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(
      "✅ Stop response received (async):",
      JSON.stringify(stopRes.data, null, 2),
    );

    // STEP 2: Extract file list from stop response (may be empty with async_stop)
    const serverResponse = stopRes.data?.serverResponse;
    const filesFromStop = serverResponse?.fileList || [];
    const uploadingStatus = serverResponse?.uploadingStatus || "backuped";

    // Extract actual file names from the fileList if available
    // Agora returns fileList as array of objects: [{ fileName: "sid_cname.mp4", ... }]
    // or as array of strings depending on mode
    let fileNames: string[] = [];
    if (filesFromStop.length > 0) {
      fileNames = filesFromStop.map((f: any) =>
        typeof f === "string" ? f : f.fileName || f.filename || "",
      ).filter(Boolean);
    }

    // STEP 3: Build the recording URL(s)
    const urls = buildRecordingUrls(
      sid,
      channelName,
      fileNames.length > 0 ? fileNames : undefined,
    );

    console.log("🎬 Recording URL:", urls.recordingUrl);
    console.log("📁 All recording files:", urls.allFiles);

    // STEP 4: Return response with recording URL
    const responseData = {
      success: true,
      message: "Recording stopped. Files queued for S3 upload.",

      // ★ THE KEY FIELD — use this to save to your database
      recordingUrl: urls.recordingUrl,

      // All recording URLs (MP4, M3U8, etc.)
      recordingUrls: urls,

      recordingData: stopRes.data,
      s3Upload: {
        status: uploadingStatus,
        uploadingStatus: uploadingStatus,
        files: filesFromStop,
        bucket: process.env.AWS_STORAGE_BUCKET_NAME,
        region: AGORA_REGION_TO_AWS[Number(process.env.AWS_S3_REGION_CODE || 0)] || "us-east-1",
        note: "Recording stopped. Files will be uploaded to S3 within 1-5 minutes.",
      },
      timestamp: new Date().toISOString(),
    };

    console.log("📦 Final response:", JSON.stringify(responseData, null, 2));

    // Async polling in background (completely non-blocking)
    pollS3UploadStatus(resourceId, sid, 3).catch((err) => {
      console.warn("Background polling failed:", err.message);
    });

    return NextResponse.json(responseData, { status: 200 });
  } catch (err: any) {
    const agoraError = err?.response?.data;
    const status = err?.response?.status ?? 500;
    console.error("❌ Agora stop error:", agoraError || err.message);

    return NextResponse.json(
      {
        success: false,
        error: err.message,
        agoraError,
        hint:
          agoraError?.code === 435
            ? "No audio/video was received by the recording bot. Check: (1) publisher joined and published before start was called, (2) channel profile matches (rtc ↔ channelType:0, live ↔ channelType:1), (3) publisher tokens are valid."
            : "Recording stop failed. Check Agora credentials and network connection.",
      },
      { status },
    );
  }
}
