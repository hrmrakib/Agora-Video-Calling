/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";

interface Participant {
  uid: string;
  displayName: string;
  avatarColor: string;
  status: "approved" | "pending" | "rejected";
  joinedAt: number;
}

interface MeetingRoom {
  host: string;
  hostName: string;
  participants: Participant[];
  createdAt: number;
}

// Access the same global store
const meetingStore =
  ((globalThis as any).__meetingStore as Map<string, MeetingRoom>) ??
  ((globalThis as any).__meetingStore = new Map<string, MeetingRoom>());

export async function POST(req: NextRequest) {
  try {
    const { channelName, uid } = await req.json();

    if (!channelName || !uid) {
      return NextResponse.json(
        { error: "channelName and uid are required" },
        { status: 400 },
      );
    }

    const room = meetingStore.get(channelName);

    if (!room) {
      return NextResponse.json({
        success: true,
        message: "Room not found (already cleaned up)",
      });
    }

    const isHost = room.host === String(uid);

    if (isHost) {
      // Host is leaving — delete the entire room so the next person can become host
      meetingStore.delete(channelName);
      console.log(`🗑️ Meeting room deleted: ${channelName} (host left)`);
      return NextResponse.json({
        success: true,
        message: "Meeting room closed (host left)",
      });
    } else {
      // Regular participant leaving — remove them from the list
      room.participants = room.participants.filter(
        (p) => p.uid !== String(uid),
      );
      console.log(`👋 Participant ${uid} left ${channelName}`);
      return NextResponse.json({ success: true, message: "Left the meeting" });
    }
  } catch (err) {
    console.error("Leave error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
