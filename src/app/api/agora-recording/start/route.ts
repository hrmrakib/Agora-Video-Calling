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

const RECORDING_UID = "123456789";

// Small delay helper so the bot has a moment to settle after acquire
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(req: NextRequest) {
  const { channelName } = await req.json();
  console.log("Start recording for channel:", channelName);

  if (!channelName) {
    return NextResponse.json(
      { error: "channelName is required" },
      { status: 400 },
    );
  }

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
    console.log("Acquired resourceId:", resourceId);

    // Give Agora a brief moment to provision the recording resource
    await sleep(500);

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
              width: 640,
              height: 360,
              fps: 15,
              bitrate: 500,
              mixedVideoLayout: 1, // 1 = best fit
              backgroundColor: "#000000",
            },
          },
          recordingFileConfig: {
            avFileType: ["hls", "mp4"],
          },
          storageConfig: {
            vendor: 1, // 1 = AWS S3
            region: 0,
            bucket: process.env.AWS_BUCKET!,
            accessKey: process.env.AWS_ACCESS_KEY!,
            secretKey: process.env.AWS_SECRET_KEY!,
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

    console.log("Recording started. sid:", startRes.data.sid);

    return NextResponse.json({
      resourceId,
      sid: startRes.data.sid,
    });
  } catch (err: any) {
    const agoraError = err?.response?.data;
    const status = err?.response?.status ?? 500;
    console.error("Agora start error:", agoraError || err.message);

    return NextResponse.json(
      {
        error: err.message,
        agoraError,
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
