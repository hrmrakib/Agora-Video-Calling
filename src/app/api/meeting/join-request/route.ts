/* eslint-disable @typescript-eslint/no-explicit-any */
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
  hostLastSeen?: number; // updated by heartbeat every 2s while host is connected
}

// Global in-memory store (survives across requests in the same server process)
const meetingStore = (globalThis as any).__meetingStore as Map<string, MeetingRoom> ??
  ((globalThis as any).__meetingStore = new Map<string, MeetingRoom>());

/** Create a fresh room with the given user as host */
function createRoom(channelName: string, uid: string, displayName: string, avatarColor: string): MeetingRoom {
  const participant: Participant = {
    uid,
    displayName,
    avatarColor: avatarColor || "#6366f1",
    status: "approved",
    joinedAt: Date.now(),
  };
  const room: MeetingRoom = {
    host: uid,
    hostName: displayName,
    participants: [participant],
    createdAt: Date.now(),
    hostLastSeen: Date.now(),
  };
  meetingStore.set(channelName, room);
  console.log(`✅ Meeting created: ${channelName}, host: ${displayName} (${uid})`);
  return room;
}

export async function POST(req: NextRequest) {
  try {
    const { channelName, uid, displayName, avatarColor } = await req.json();

    if (!channelName || !uid || !displayName) {
      return NextResponse.json(
        { error: "channelName, uid, and displayName are required" },
        { status: 400 }
      );
    }

    const uidStr = String(uid);
    let room = meetingStore.get(channelName);

    // ── Check 1: 2-hour hard expiry ──────────────────────────────────────────
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    if (room && Date.now() - room.createdAt > TWO_HOURS) {
      console.log(`⏰ Room ${channelName} expired (>2h), resetting.`);
      meetingStore.delete(channelName);
      room = undefined as any;
    }

    // ── Check 2: Room exists but has NO approved participants ─────────────────
    if (room) {
      const approvedCount = room.participants.filter((p) => p.status === "approved").length;
      if (approvedCount === 0) {
        console.log(`🔄 Room ${channelName} has no approved participants, resetting.`);
        meetingStore.delete(channelName);
        room = undefined as any;
      }
    }

    // ── Check 3: Host heartbeat — is the host still actively connected? ───────
    // The host polls /api/meeting/status every 2s with heartbeat=true, which
    // updates room.hostLastSeen. If hostLastSeen is older than 20 seconds (or
    // was never set), the host has disconnected without cleanup (closed tab,
    // crash, etc.) → treat the room as abandoned and reset it.
    const HEARTBEAT_TIMEOUT = 20 * 1000; // 20 seconds
    if (room) {
      const lastSeen = room.hostLastSeen ?? room.createdAt;
      const hostGone = Date.now() - lastSeen > HEARTBEAT_TIMEOUT;
      if (hostGone) {
        console.log(`💔 Room ${channelName}: host heartbeat timed out (>20s), resetting.`);
        meetingStore.delete(channelName);
        room = undefined as any;
      }
    }

    // ── No room (or room was reset) → first joiner becomes host ─────────────
    if (!room) {
      createRoom(channelName, uidStr, displayName, avatarColor);
      return NextResponse.json({
        status: "approved",
        isHost: true,
        hostName: displayName,
        message: "You are the host of this meeting.",
      });
    }

    // ── Room exists with active host ─────────────────────────────────────────

    // Already in the room → return current status
    const existing = room.participants.find((p) => p.uid === uidStr);
    if (existing) {
      return NextResponse.json({
        status: existing.status,
        isHost: room.host === uidStr,
        hostName: room.hostName,
      });
    }

    // New participant → add as pending, wait for host to approve
    const participant: Participant = {
      uid: uidStr,
      displayName,
      avatarColor: avatarColor || "#6366f1",
      status: "pending",
      joinedAt: Date.now(),
    };
    room.participants.push(participant);

    console.log(`⏳ Join request: ${displayName} (${uidStr}) → ${channelName} (pending)`);

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
