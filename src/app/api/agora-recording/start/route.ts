/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;

const auth = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString(
  "base64",
);

export async function POST(req: NextRequest) {
  const { channelName, uid } = await req.json();

  try {
    // STEP 1: Acquire resource
    const acquireRes = await axios.post(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/acquire`,
      {
        cname: channelName,
        uid: uid.toString(),
        clientRequest: {},
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    const resourceId = acquireRes.data.resourceId;

    // STEP 2: Start recording
    const startRes = await axios.post(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/mode/mix/start`,
      {
        cname: channelName,
        uid: uid.toString(),
        clientRequest: {
          recordingConfig: {
            maxIdleTime: 30,
            streamTypes: 2,
            channelType: 0,
          },
          storageConfig: {
            vendor: 1, // 1 = AWS S3
            region: 0,
            bucket: process.env.AWS_BUCKET!,
            accessKey: process.env.AWS_ACCESS_KEY!,
            secretKey: process.env.AWS_SECRET_KEY!,
          },
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    return NextResponse.json({
      resourceId,
      sid: startRes.data.sid,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
