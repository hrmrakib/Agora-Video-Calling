/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { RtcTokenBuilder, RtcRole } from "agora-access-token";

const APP_ID = process.env.AGORA_APP_ID!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;
const auth = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString(
  "base64",
);

// Generate a unique recording UID per session to avoid error 53 "task conflict"
function generateRecordingUid() {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

// Small delay helper so the bot has a moment to settle after acquire
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(req: NextRequest) {
  const { channelName, isScreenSharing } = await req.json();
  const RECORDING_UID = generateRecordingUid();
  console.log("Start recording for channel:", channelName, {
    isScreenSharing,
    recordingUid: RECORDING_UID,
  });

  if (!channelName) {
    return NextResponse.json(
      { error: "channelName is required" },
      { status: 400 },
    );
  }

  // ✅ Validate S3 environment variables with fallback support
  const bucketName = process.env.AWS_STORAGE_BUCKET_NAME;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const regionCode = process.env.AWS_S3_REGION_CODE;
  const demoMode = process.env.DEMO_MODE === "true";

  // Check if we have valid S3 config
  const hasValidS3 = bucketName && accessKey && secretKey;

  if (!hasValidS3 && !demoMode) {
    console.error("\n❌ AWS S3 Configuration Missing");
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("To enable recording, add to .env.local:");
    console.error("  AWS_STORAGE_BUCKET_NAME=your-bucket-name");
    console.error("  AWS_ACCESS_KEY_ID=your-access-key");
    console.error("  AWS_SECRET_ACCESS_KEY=your-secret-key");
    console.error(
      "  AWS_S3_REGION_CODE=0  (0=US-East, 1=US-West, 8=Frankfurt, 3=Singapore)",
    );
    console.error("\nOr enable demo mode:");
    console.error("  DEMO_MODE=true");
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    return NextResponse.json(
      {
        error: "Recording not configured",
        details:
          "Add AWS S3 credentials to .env.local or set DEMO_MODE=true for testing",
        setupInstructions: "See server logs for configuration instructions",
      },
      { status: 400 },
    );
  }

  if (demoMode) {
    console.log("ℹ️  DEMO_MODE enabled - returning mock recording response");
    return NextResponse.json({
      resourceId: `demo-resource-${Date.now()}`,
      sid: `demo-sid-${Date.now()}`,
      message: "Demo recording started (not actually recording to S3)",
    });
  }

  console.log("✅ S3 Configuration validated:");
  console.log("  Bucket:", bucketName);
  console.log("  Region code:", regionCode || "0 (US East N. Virginia)");

  // ✅ Screen Share Recording: Adjust resolution based on screen sharing status
  // Screen share content needs higher resolution to be readable
  const recordingWidth = isScreenSharing ? 1280 : 640;
  const recordingHeight = isScreenSharing ? 720 : 360;
  const recordingBitrate = isScreenSharing ? 1500 : 500; // Higher bitrate for screen

  // Build recording token for the bot UID
  const recordingToken = RtcTokenBuilder.buildTokenWithUid(
    process.env.AGORA_APP_ID!,
    process.env.AGORA_APP_CERTIFICATE!,
    channelName,
    Number(RECORDING_UID),
    RtcRole.PUBLISHER,
    Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
  );

  try {
    // STEP 1: Acquire resource
    const acquireRes = await axios.post(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/acquire`,
      {
        cname: channelName,
        uid: RECORDING_UID,
        clientRequest: {
          resourceExpiredHour: 24,
          scene: 0, // 0 = real-time recording
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      },
    );

    const resourceId = acquireRes.data.resourceId;
    console.log("✅ Acquired resourceId:", resourceId);

    // ✅ FIX 3a: Wait for channel to have at least one active publisher
    // If we start recording too quickly before any streams are publishing,
    // Agora returns error 435 (no media received)
    console.log(
      "⏳ Waiting 2 seconds for channel to have active publishers...",
    );
    await sleep(2000);

    // STEP 2: Start recording
    const startRes = await axios.post(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/mode/mix/start`,
      {
        cname: channelName,
        uid: RECORDING_UID,
        clientRequest: {
          token: recordingToken,
          recordingConfig: {
            maxIdleTime: 120, // Wait up to 2 min for publishers before auto-stopping
            streamTypes: 2, // 0=audio only, 1=video only, 2=both
            channelType: 0, // 0 = Communication (rtc), 1 = Live Broadcast
            videoStreamType: 0, // 0 = high stream
            subscribeVideoUids: ["#allstream#"],
            subscribeAudioUids: ["#allstream#"],
            subscribeUidGroup: 0,
            transcodingConfig: {
              width: recordingWidth,
              height: recordingHeight,
              fps: isScreenSharing ? 30 : 15, // Higher FPS for screen share
              bitrate: recordingBitrate,
              mixedVideoLayout: 1, // 1 = best fit
              backgroundColor: "#000000",
            },
          },
          recordingFileConfig: {
            avFileType: ["hls", "mp4"],
          },
          storageConfig: {
            vendor: 1, // 1 = AWS S3
            // ✅ FIX 3b: Correct S3 region mapping (must match AWS bucket region)
            // Agora numeric codes:
            // 0 = US East (N. Virginia)
            // 1 = US West (Oregon)
            // 8 = EU (Frankfurt)
            // 3 = Asia Pacific (Singapore)
            // Set AWS_S3_REGION_CODE in .env.local to match your bucket's region
            region: Number(regionCode || 0),
            bucket: bucketName,
            accessKey: accessKey,
            secretKey: secretKey,
            fileNamePrefix: ["recordings", channelName],
          },
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("✅ Recording started.", {
      sid: startRes.data.sid,
      resolution: `${recordingWidth}x${recordingHeight}`,
      isScreenSharing,
      bitrate: `${recordingBitrate} kbps`,
    });

    return NextResponse.json({
      resourceId,
      sid: startRes.data.sid,
      recordingUid: RECORDING_UID,
    });
  } catch (err: any) {
    const agoraError = err?.response?.data;
    const status = err?.response?.status ?? 500;

    // ✅ FIX 3c: Log full Agora error details for debugging
    console.error("❌ Agora recording start error:");
    console.error("  Status:", status);
    console.error("  Message:", err.message);
    console.error("  Agora response:", agoraError);
    console.error(
      "  Screen sharing was:",
      isScreenSharing ? "active" : "inactive",
    );

    // Check for specific error codes
    if (status === 435 || agoraError?.code === 435) {
      console.error("  🚨 ERROR 435: No media/publisher in channel yet.");
      console.error(
        "     Ensure at least one user has published their audio/video before starting recording.",
      );
    }

    return NextResponse.json(
      {
        error: err.message,
        agoraError,
        details: `Agora status ${status}: ${agoraError?.noticeMsg || err.message}`,
      },
      { status },
    );
  }
}

// /* eslint-disable @typescript-eslint/no-explicit-any */
// import { NextRequest, NextResponse } from "next/server";
// import axios from "axios";
// import { RtcTokenBuilder, RtcRole } from "agora-access-token";

// const APP_ID = process.env.AGORA_APP_ID!;
// const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
// const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;

// const auth = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString(
//   "base64",
// );

// export async function POST(req: NextRequest) {
//   // const { channelName, uid } = await req.json();
//   const { channelName } = await req.json();

//   console.log({ channelName });

//   const RECORDING_UID = "123456789";

//   const recordingToken = RtcTokenBuilder.buildTokenWithUid(
//     process.env.AGORA_APP_ID!,
//     process.env.AGORA_APP_CERTIFICATE!,
//     channelName,
//     Number(RECORDING_UID),
//     RtcRole.PUBLISHER,
//     Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
//   );

//   try {
//     // STEP 1: Acquire resource
//     const acquireRes = await axios.post(
//       `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/acquire`,
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

//     const resourceId = acquireRes.data.resourceId;

//     // STEP 2: Start recording
//     const startRes = await axios.post(
//       `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/mode/mix/start`,
//       {
//         cname: channelName,
//         // uid: uid.toString(),
//         uid: RECORDING_UID,
//         clientRequest: {
//           token: recordingToken,
//           recordingConfig: {
//             maxIdleTime: 30,
//             streamTypes: 2,
//             channelType: 1,
//             subscribeVideoUids: ["#allstream#"], // ← record ALL video streams
//             subscribeAudioUids: ["#allstream#"],
//           },
//           storageConfig: {
//             vendor: 1, // 1 = AWS S3
//             region: 0,
//             bucket: process.env.AWS_BUCKET!,
//             accessKey: process.env.AWS_ACCESS_KEY!,
//             secretKey: process.env.AWS_SECRET_KEY!,
//           },
//         },
//       },
//       {
//         headers: {
//           Authorization: `Basic ${auth}`,
//         },
//       },
//     );

//     return NextResponse.json({
//       resourceId,
//       sid: startRes.data.sid,
//     });
//   } catch (err: any) {
//     return NextResponse.json({ error: err.message }, { status: 500 });
//   }
// }
