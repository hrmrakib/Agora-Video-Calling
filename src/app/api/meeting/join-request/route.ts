import { NextRequest, NextResponse } from "next/server";

// ─── In-memory meeting store ──────────────────────────────────────────────────
// Structure: channelName → { host, participants: [{uid, displayName, avatarColor, status}] }

interface Participant {
  uid: string;
  displayName: string;
  avatarColor: string;
  status: "approved" | "pending" | "rejected";
  joinedAt: number;
}

interface MeetingRoom {
  host: string; // uid of the host
  hostName: string;
  participants: Participant[];
  createdAt: number;
}

// Global in-memory store (survives across requests in the same server process)
const meetingStore = (globalThis as any).__meetingStore as Map<string, MeetingRoom> ??
  ((globalThis as any).__meetingStore = new Map<string, MeetingRoom>());

export async function POST(req: NextRequest) {
  try {
    const { channelName, uid, displayName, avatarColor } = await req.json();

    if (!channelName || !uid || !displayName) {
      return NextResponse.json(
        { error: "channelName, uid, and displayName are required" },
        { status: 400 }
      );
    }

    let room = meetingStore.get(channelName);

    // First person to request → becomes host, auto-approved
    if (!room) {
      const participant: Participant = {
        uid: String(uid),
        displayName,
        avatarColor: avatarColor || "#6366f1",
        status: "approved",
        joinedAt: Date.now(),
      };

      room = {
        host: String(uid),
        hostName: displayName,
        participants: [participant],
        createdAt: Date.now(),
      };

      meetingStore.set(channelName, room);

      console.log(`✅ Meeting created: ${channelName}, host: ${displayName} (${uid})`);

      return NextResponse.json({
        status: "approved",
        isHost: true,
        hostName: displayName,
        message: "You are the host of this meeting.",
      });
    }

    // Check if user already has a request
    const existing = room.participants.find((p) => p.uid === String(uid));
    if (existing) {
      return NextResponse.json({
        status: existing.status,
        isHost: room.host === String(uid),
        hostName: room.hostName,
      });
    }

    // New participant → pending approval
    const participant: Participant = {
      uid: String(uid),
      displayName,
      avatarColor: avatarColor || "#6366f1",
      status: "pending",
      joinedAt: Date.now(),
    };

    room.participants.push(participant);

    console.log(`⏳ Join request: ${displayName} (${uid}) → ${channelName} (pending)`);

    return NextResponse.json({
      status: "pending",
      isHost: false,
      hostName: room.hostName,
      message: "Waiting for host to approve your request.",
    });
  } catch (err) {
    console.error("Join request error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
