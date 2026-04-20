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

export async function POST(req: NextRequest) {
  const { channelName, resourceId, sid } = await req.json();
  console.log("Stop recording:", { channelName, resourceId, sid });

  if (!channelName || !resourceId || !sid) {
    return NextResponse.json(
      { error: "channelName, resourceId, and sid are required" },
      { status: 400 },
    );
  }

  try {
    // OPTIONAL: Query status before stopping to see what bot received
    try {
      const queryRes = await axios.get(
        `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/query`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
          },
        },
      );
      console.log("Pre-stop query:", JSON.stringify(queryRes.data, null, 2));
    } catch (queryErr: any) {
      console.warn(
        "Pre-stop query failed (non-fatal):",
        queryErr?.response?.data || queryErr.message,
      );
    }

    // STOP recording
    const stopRes = await axios.post(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
      {
        cname: channelName,
        uid: RECORDING_UID,
        clientRequest: {
          async_stop: false,
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("Stop response:", JSON.stringify(stopRes.data, null, 2));

    return NextResponse.json(stopRes.data);
  } catch (err: any) {
    const agoraError = err?.response?.data;
    const status = err?.response?.status ?? 500;
    console.error("Agora stop error:", agoraError || err.message);

    // Give frontend rich info so you can debug error 435 etc.
    return NextResponse.json(
      {
        error: err.message,
        agoraError,
        hint:
          agoraError?.code === 435
            ? "No audio/video was received by the recording bot. Check: (1) publisher joined and published before start was called, (2) channel profile matches (rtc ↔ channelType:0, live ↔ channelType:1), (3) publisher tokens are valid."
            : undefined,
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
