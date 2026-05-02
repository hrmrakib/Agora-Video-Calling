/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const APP_ID = process.env.AGORA_APP_ID!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;
const auth = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString(
  "base64",
);

// Agora region code → AWS region string
const AGORA_REGION_TO_AWS: Record<number, string> = {
  0: "us-east-1",
  1: "us-west-2",
  2: "eu-west-1",
  3: "ap-southeast-1",
  4: "ap-northeast-1",
  8: "eu-central-1",
};

/**
 * GET /api/agora-recording/query?resourceId=xxx&sid=xxx&channelName=xxx
 *
 * Query the status of a cloud recording session and return the recording URLs.
 * Use this endpoint to check if the recording has been uploaded to S3
 * and to get the final file URLs for saving to your database.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const resourceId = searchParams.get("resourceId");
  const sid = searchParams.get("sid");
  const channelName = searchParams.get("channelName");

  if (!resourceId || !sid || !channelName) {
    return NextResponse.json(
      { error: "resourceId, sid, and channelName are required as query params" },
      { status: 400 },
    );
  }

  const bucket = process.env.AWS_STORAGE_BUCKET_NAME;
  const regionCode = Number(process.env.AWS_S3_REGION_CODE || 0);
  const awsRegion = AGORA_REGION_TO_AWS[regionCode] || "us-east-1";
  const safeChannelName = channelName.replace(/[^a-zA-Z0-9_-]/g, "-");
  const baseUrl = `https://${bucket}.s3.${awsRegion}.amazonaws.com`;
  const prefix = `recordings/${channelName}`;

  try {
    const queryRes = await axios.get(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/query`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    const serverResponse = queryRes.data?.serverResponse;
    const uploadingStatus = serverResponse?.uploadingStatus || "unknown";
    const fileList = serverResponse?.fileList || [];

    // Extract file names
    let fileNames: string[] = [];
    if (fileList.length > 0) {
      fileNames = fileList
        .map((f: any) =>
          typeof f === "string" ? f : f.fileName || f.filename || "",
        )
        .filter(Boolean);
    }

    // Build URLs from actual file list or predicted names
    let recordingUrl: string;
    let allFiles: string[];

    if (fileNames.length > 0) {
      const mp4Files = fileNames.filter((f: string) => f.endsWith(".mp4"));
      allFiles = fileNames.map((f: string) => `${baseUrl}/${prefix}/${f}`);
      recordingUrl =
        mp4Files.length > 0
          ? `${baseUrl}/${prefix}/${mp4Files[0]}`
          : allFiles[0];
    } else {
      // Predicted names
      const mp4FileName = `${sid}_${safeChannelName}.mp4`;
      recordingUrl = `${baseUrl}/${prefix}/${mp4FileName}`;
      allFiles = [
        recordingUrl,
        `${baseUrl}/${prefix}/${sid}_${safeChannelName}.m3u8`,
      ];
    }

    return NextResponse.json({
      success: true,
      uploadingStatus,
      isUploaded:
        uploadingStatus === "uploaded" || uploadingStatus === "backuped",
      recordingUrl,
      allFiles,
      bucket,
      region: awsRegion,
      rawResponse: queryRes.data,
    });
  } catch (err: any) {
    // 404 = resource already released (normal after recording ends)
    if (err?.response?.status === 404) {
      // Recording is done, resource released — construct the URL from known pattern
      const mp4FileName = `${sid}_${safeChannelName}.mp4`;
      const recordingUrl = `${baseUrl}/${prefix}/${mp4FileName}`;

      return NextResponse.json({
        success: true,
        uploadingStatus: "completed",
        isUploaded: true,
        recordingUrl,
        allFiles: [
          recordingUrl,
          `${baseUrl}/${prefix}/${sid}_${safeChannelName}.m3u8`,
        ],
        bucket,
        region: awsRegion,
        note: "Recording resource released (404). Files should be available in S3.",
      });
    }

    console.error("❌ Query error:", err?.response?.data || err.message);
    return NextResponse.json(
      {
        success: false,
        error: err.message,
        agoraError: err?.response?.data,
      },
      { status: err?.response?.status ?? 500 },
    );
  }
}
