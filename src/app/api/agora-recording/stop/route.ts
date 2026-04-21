/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const APP_ID = process.env.AGORA_APP_ID!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;
const auth = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString(
  "base64",
);

const RECORDING_UID = "123456789";

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
  const { channelName, resourceId, sid } = await req.json();
  console.log("🛑 Stop recording:", { channelName, resourceId, sid });

  if (!channelName || !resourceId || !sid) {
    return NextResponse.json(
      { error: "channelName, resourceId, and sid are required" },
      { status: 400 },
    );
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

    // STEP 2: Get file list from stop response (may be empty with async_stop: true)
    const filesFromStop = stopRes.data?.serverResponse?.fileList || [];
    const uploadingStatus =
      stopRes.data?.serverResponse?.uploadingStatus || "backuped";

    // STEP 3: Return response immediately
    const responseData = {
      success: true,
      message: "Recording stopped. Files queued for S3 upload.",
      recordingData: stopRes.data,
      s3Upload: {
        status: uploadingStatus,
        uploadingStatus: uploadingStatus,
        files: filesFromStop,
        bucket: process.env.AWS_STORAGE_BUCKET_NAME,
        region: process.env.AWS_S3_REGION_NAME,
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

// /* eslint-disable @typescript-eslint/no-explicit-any */
// import { NextRequest, NextResponse } from "next/server";
// import axios from "axios";

// const APP_ID = process.env.AGORA_APP_ID!;
// const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
// const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;

// const auth = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString(
//   "base64",
// );

// const RECORDING_UID = "123456789";

// export async function POST(req: NextRequest) {
//   // const { channelName, uid, resourceId, sid } = await req.json();
//   const { channelName, resourceId, sid } = await req.json();

//   console.log({ channelName, resourceId, sid });

//   try {
//     const stopRes = await axios.post(
//       `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
//       {
//         cname: channelName,
//         // uid: uid.toString(),
//         uid: RECORDING_UID,
//         clientRequest: {},
//       },
//       {
//         headers: {
//           Authorization: `Basic ${auth}`,
//         },
//       },
//     );

//     console.log({ stopRes });

//     return NextResponse.json(stopRes.data);
//   } catch (err: any) {
//     const agoraError = err?.response?.data;
//     const status = err?.response?.status ?? 500;
//     console.error("Agora stop error:", err);

//     return NextResponse.json({ error: err.message }, { status: 500 });
//   }
// }
