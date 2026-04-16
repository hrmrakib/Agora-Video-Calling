import { RtcTokenBuilder, RtcRole } from "agora-token";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const channelName = searchParams.get("channelName");

  if (!channelName) {
    return NextResponse.json(
      { error: "channelName is required" },
      { status: 400 },
    );
  }

  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate) {
    return NextResponse.json(
      {
        error:
          "Missing NEXT_PUBLIC_AGORA_APP_ID or AGORA_APP_CERTIFICATE in environment variables.",
      },
      { status: 500 },
    );
  }

  // uid 0 = Agora assigns one automatically
  const uid = Math.floor(Math.random() * 100000);
  const role = RtcRole.PUBLISHER;
  const tokenExpirySeconds = 3600; // 1 hour
  const privilegeExpireTime =
    Math.floor(Date.now() / 1000) + tokenExpirySeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    role,
    privilegeExpireTime,
    privilegeExpireTime,
  );

  return NextResponse.json({ token, uid });
}
