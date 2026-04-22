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
const meetingStore = (globalThis as any).__meetingStore as Map<string, MeetingRoom> ??
  ((globalThis as any).__meetingStore = new Map<string, MeetingRoom>());

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const channelName = searchParams.get("channelName");
    const uid = searchParams.get("uid");

    if (!channelName || !uid) {
      return NextResponse.json(
        { error: "channelName and uid are required" },
        { status: 400 }
      );
    }

    const room = meetingStore.get(channelName);

    if (!room) {
      return NextResponse.json({
        status: "no_room",
        message: "Meeting room not found. You may be the first to join.",
      });
    }

    const isHost = room.host === String(uid);
    const self = room.participants.find((p) => p.uid === String(uid));

    // Build response
    const response: any = {
      status: self?.status || "unknown",
      isHost,
      hostName: room.hostName,
    };

    // If the requester is the host, include pending requests
    if (isHost) {
      response.pendingRequests = room.participants
        .filter((p) => p.status === "pending")
        .map((p) => ({
          uid: p.uid,
          displayName: p.displayName,
          avatarColor: p.avatarColor,
          joinedAt: p.joinedAt,
        }));

      response.approvedParticipants = room.participants
        .filter((p) => p.status === "approved")
        .map((p) => ({
          uid: p.uid,
          displayName: p.displayName,
          avatarColor: p.avatarColor,
        }));
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error("Status check error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
