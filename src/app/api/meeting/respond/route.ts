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

export async function POST(req: NextRequest) {
  try {
    const { channelName, hostUid, targetUid, action } = await req.json();

    if (!channelName || !hostUid || !targetUid || !action) {
      return NextResponse.json(
        { error: "channelName, hostUid, targetUid, and action are required" },
        { status: 400 }
      );
    }

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    const room = meetingStore.get(channelName);

    if (!room) {
      return NextResponse.json(
        { error: "Meeting room not found" },
        { status: 404 }
      );
    }

    // Verify the requester is actually the host
    if (room.host !== String(hostUid)) {
      return NextResponse.json(
        { error: "Only the host can approve or reject participants" },
        { status: 403 }
      );
    }

    // Find the target participant
    const target = room.participants.find((p) => p.uid === String(targetUid));

    if (!target) {
      return NextResponse.json(
        { error: "Participant not found" },
        { status: 404 }
      );
    }

    // Update status
    target.status = action === "approve" ? "approved" : "rejected";

    console.log(
      `${action === "approve" ? "✅" : "❌"} Host ${room.hostName} ${action}d ${target.displayName} (${targetUid}) in ${channelName}`
    );

    return NextResponse.json({
      success: true,
      action,
      targetUid,
      targetName: target.displayName,
      message: `${target.displayName} has been ${action === "approve" ? "approved" : "rejected"}.`,
    });
  } catch (err) {
    console.error("Respond error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
