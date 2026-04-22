/* eslint-disable react-hooks/globals */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AgoraRTC, {
  AgoraRTCProvider,
  ILocalVideoTrack,
  LocalVideoTrack,
  RemoteUser,
  useJoin,
  useLocalCameraTrack,
  useLocalMicrophoneTrack,
  useRemoteUsers,
} from "agora-rtc-react";
import { Disc2, DiscAlbum } from "lucide-react";

interface VideoCallProps {
  channelName: string;
  appId: string;
  displayName?: string;
  avatarColor?: string;
}

interface ScreenTrackState {
  videoTrack: ILocalVideoTrack;
  audioTrack?: any;
  _onEnded: () => void;
}

// Create client inside component to avoid SSR issues
let client: any = null;

export default function VideoCall({ channelName, appId, displayName = "Guest", avatarColor = "#6366f1" }: VideoCallProps) {
  // Initialize client on first render (client-side only)
  if (!client) {
    client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  }
  if (!appId) {
    return (
      <div className='error-screen'>
        <style>{errorStyles}</style>
        <p>
          Missing Agora App ID. Add <code>NEXT_PUBLIC_AGORA_APP_ID</code> to
          your <code>.env.local</code> and restart the dev server.
        </p>
        <button onClick={() => window.history.back()} className='back-btn'>
          ← Go back
        </button>
      </div>
    );
  }
  return (
    <AgoraRTCProvider client={client}>
      <CallUI channelName={channelName} appId={appId} displayName={displayName} avatarColor={avatarColor} />
    </AgoraRTCProvider>
  );
}

function CallUI({ channelName, appId, displayName = "Guest", avatarColor = "#6366f1" }: VideoCallProps) {
  const router = useRouter();
  const [micMuted, setMicMuted] = useState(false);
  const [camMuted, setCamMuted] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  const [screenTrack, setScreenTrack] = useState<ScreenTrackState | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<number | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState("");
  const [uid, setUid] = useState<number | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [sid, setSid] = useState("");
  const [recordingUid, setRecordingUid] = useState("");

  // ─── Meeting Timer ──────────────────────────────────────────────
  const [meetingStartTime, setMeetingStartTime] = useState<number | null>(null);
  const [meetingElapsed, setMeetingElapsed] = useState("00:00:00");

  // ─── Recording Timer ──────────────────────────────────────────
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [recordingElapsed, setRecordingElapsed] = useState("00:00:00");

  // ─── Host Approval ────────────────────────────────────────────
  const [approvalStatus, setApprovalStatus] = useState<"checking" | "approved" | "pending" | "rejected">("checking");
  const [isHost, setIsHost] = useState(false);
  const [hostName, setHostName] = useState("");
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  // ─── Remote user display names ────────────────────────────────
  const [remoteNames, setRemoteNames] = useState<Record<string, { name: string; color: string }>>({});

  const stopScreenShareRef = useRef<() => void>(() => {});
  const hasPublishedRef = useRef(false);

  // ─── Timer utility ────────────────────────────────────────────
  const formatElapsed = useCallback((startMs: number) => {
    const diff = Math.floor((Date.now() - startMs) / 1000);
    const h = String(Math.floor(diff / 3600)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const s = String(diff % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, []);

  // ─── Meeting Timer Effect ─────────────────────────────────────
  useEffect(() => {
    if (!meetingStartTime) return;
    const iv = setInterval(() => setMeetingElapsed(formatElapsed(meetingStartTime)), 1000);
    return () => clearInterval(iv);
  }, [meetingStartTime, formatElapsed]);

  // ─── Recording Timer Effect ───────────────────────────────────
  useEffect(() => {
    if (!recordingStartTime) return;
    const iv = setInterval(() => setRecordingElapsed(formatElapsed(recordingStartTime)), 1000);
    return () => clearInterval(iv);
  }, [recordingStartTime, formatElapsed]);

  // ─── Host Approval Flow ──────────────────────────────────────
  // Step 1: On mount, send join request to get approval status
  useEffect(() => {
    if (!uid) return; // wait for uid from token fetch
    async function requestJoin() {
      try {
        const res = await fetch("/api/meeting/join-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelName, uid: String(uid), displayName, avatarColor }),
        });
        const data = await res.json();
        setApprovalStatus(data.status === "approved" ? "approved" : data.status === "rejected" ? "rejected" : "pending");
        setIsHost(!!data.isHost);
        setHostName(data.hostName || "");
        if (data.isHost) setMeetingStartTime(Date.now());
      } catch (err) {
        console.error("Join request failed:", err);
        setApprovalStatus("approved"); // fallback: allow join on error
      }
    }
    requestJoin();
  }, [uid, channelName, displayName, avatarColor]);

  // Step 2: Poll for approval status (non-hosts only)
  useEffect(() => {
    if (approvalStatus !== "pending" || !uid) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/meeting/status?channelName=${encodeURIComponent(channelName)}&uid=${uid}`);
        const data = await res.json();
        if (data.status === "approved") {
          setApprovalStatus("approved");
          setMeetingStartTime(Date.now());
          clearInterval(iv);
        } else if (data.status === "rejected") {
          setApprovalStatus("rejected");
          clearInterval(iv);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [approvalStatus, uid, channelName]);

  // Step 3: Host polls for pending requests
  useEffect(() => {
    if (!isHost || !uid) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/meeting/status?channelName=${encodeURIComponent(channelName)}&uid=${uid}`);
        const data = await res.json();
        if (data.pendingRequests) setPendingRequests(data.pendingRequests);
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [isHost, uid, channelName]);

  // Host respond to join request
  async function handleApproval(targetUid: string, action: "approve" | "reject") {
    try {
      await fetch("/api/meeting/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, hostUid: String(uid), targetUid, action }),
      });
      setPendingRequests((prev) => prev.filter((p) => p.uid !== targetUid));
    } catch (err) {
      console.error("Approval action failed:", err);
    }
  }



  // Active Speaker Detection (only enable once)
  const audioVolumeIndicatorRef = useRef(false);
  useEffect(() => {
    if (audioVolumeIndicatorRef.current) return; // Already enabled

    try {
      client.enableAudioVolumeIndicator();
      audioVolumeIndicatorRef.current = true;
    } catch (err) {
      console.warn("Audio volume indicator already enabled or unavailable");
    }

    const handler = (volumes: any[]) => {
      const active = volumes.find((v) => v.level > 50);
      if (active) setActiveSpeaker(Number(active.uid));
    };
    client.on("volume-indicator", handler);
    return () => {
      client.off("volume-indicator", handler);
    };
  }, []);

  // Token fetch
  useEffect(() => {
    async function fetchToken() {
      try {
        const res = await fetch(
          `/api/agora-token?channelName=${encodeURIComponent(channelName)}`,
        );
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error ?? "Failed to fetch token");
        }
        const { token, uid } = await res.json();
        setUid(uid);
        setToken(token);
      } catch (err) {
        setTokenError(err instanceof Error ? err.message : "Unknown error");
      }
    }
    fetchToken();
  }, [channelName]);

  const { isLoading: isLoadingMic, localMicrophoneTrack } =
    useLocalMicrophoneTrack(true);
  const { isLoading: isLoadingCam, localCameraTrack } =
    useLocalCameraTrack(true);

  useEffect(() => {
    if (token && uid && localCameraTrack && localMicrophoneTrack) {
      localCameraTrack.setEnabled(true).catch(console.error);
      localMicrophoneTrack.setEnabled(true).catch(console.error);
    }
  }, [token, uid, localCameraTrack, localMicrophoneTrack]);

  const remoteUsers = useRemoteUsers();

  // Join the channel — gated behind host approval
  const { isConnected } = useJoin(
    { appid: appId, channel: channelName, token: token!, uid: uid! },
    !!token && !!uid && approvalStatus === "approved",
  );

  // Start meeting timer when connected (for non-hosts, it starts after approval)
  useEffect(() => {
    if (isConnected && !meetingStartTime) {
      setMeetingStartTime(Date.now());
    }
  }, [isConnected, meetingStartTime]);

  // Publish camera + mic ONCE after joining (manual — usePublish is unreliable)
  useEffect(() => {
    if (!isConnected || hasPublishedRef.current) return;

    const tracks: any[] = [];
    if (localMicrophoneTrack) tracks.push(localMicrophoneTrack);
    if (localCameraTrack) tracks.push(localCameraTrack);

    if (tracks.length === 0) return;

    hasPublishedRef.current = true;
    client
      .publish(tracks)
      .then(() => console.log("✅ Published", tracks.length, "tracks"))
      .catch((err: any) => {
        hasPublishedRef.current = false;
        console.error("❌ Publish failed:", err);
      });
  }, [isConnected, localMicrophoneTrack, localCameraTrack]);

  // ─── Stream messages for display name sync ────────────────────
  useEffect(() => {
    if (!isConnected) return;
    const msg = JSON.stringify({ type: "name", uid: String(uid), name: displayName, color: avatarColor });
    try {
      const encoder = new TextEncoder();
      client.sendStreamMessage(encoder.encode(msg));
    } catch {}
    const handler = (_remoteUid: any, data: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(data);
        const parsed = JSON.parse(text);
        if (parsed.type === "name" && parsed.uid) {
          setRemoteNames((prev) => ({ ...prev, [parsed.uid]: { name: parsed.name, color: parsed.color } }));
        }
      } catch {}
    };
    client.on("stream-message", handler);
    return () => { client.off("stream-message", handler); };
  }, [isConnected, uid, displayName, avatarColor]);

  // Re-broadcast name when new remote user joins
  const remoteUserCountRef = useRef(0);
  useEffect(() => {
    if (!isConnected || remoteUsers.length <= remoteUserCountRef.current) {
      remoteUserCountRef.current = remoteUsers.length;
      return;
    }
    remoteUserCountRef.current = remoteUsers.length;
    try {
      const msg = JSON.stringify({ type: "name", uid: String(uid), name: displayName, color: avatarColor });
      client.sendStreamMessage(new TextEncoder().encode(msg));
    } catch {}
  }, [remoteUsers.length, isConnected, uid, displayName, avatarColor]);

  async function toggleMic() {
    await localMicrophoneTrack?.setMuted(!micMuted);
    setMicMuted((prev) => !prev);
  }

  async function toggleCam() {
    await localCameraTrack?.setMuted(!camMuted);
    setCamMuted((prev) => !prev);
  }

  async function endCall() {
    try {
      if (screenTrack) {
        const { videoTrack, audioTrack, _onEnded } = screenTrack;
        try {
          videoTrack.off("track-ended", _onEnded);
        } catch {}
        try {
          videoTrack.stop();
        } catch {}
        try {
          videoTrack.close();
        } catch {}
        if (audioTrack) {
          try {
            audioTrack.stop();
          } catch {}
          try {
            audioTrack.close();
          } catch {}
        }
        setScreenTrack(null);
      }
      localMicrophoneTrack?.close();
      localCameraTrack?.close();
      hasPublishedRef.current = false;
      await client.leave();
    } catch (err) {
      console.error(err);
    } finally {
      router.push("/");
    }
  }

  // ─── STOP screen share ────────────────────────────────────────────
  async function stopScreenShare() {
    if (!screenTrack) return;

    const { videoTrack, audioTrack } = screenTrack;

    // 1. Unpublish screen tracks from the channel
    try {
      const tracksToUnpub: any[] = [videoTrack];
      if (audioTrack) tracksToUnpub.push(audioTrack);
      await client.unpublish(tracksToUnpub);
      console.log("✅ Screen tracks unpublished");
    } catch (err) {
      console.warn("Unpublish screen error (non-fatal):", err);
    }

    // 2. Close screen tracks
    videoTrack.stop();
    videoTrack.close();
    if (audioTrack) {
      audioTrack.stop();
      audioTrack.close();
    }

    // 3. Re-publish camera so remote users see it again
    if (localCameraTrack) {
      try {
        await client.publish(localCameraTrack);
        console.log("✅ Camera re-published after screen share");
      } catch (err) {
        console.warn("Re-publish camera error:", err);
      }
    }

    setScreenTrack(null);
  }

  stopScreenShareRef.current = stopScreenShare;

  // ─── START screen share ──────────────────────────────────────────
  async function startScreenShare() {
    try {
      // "auto" = capture system audio if supported, skip if not (macOS doesn't support it)
      // "enable" would THROW on macOS, killing the entire screen share
      const t = await AgoraRTC.createScreenVideoTrack(
        {
          encoderConfig: "1080p_1",
          // Hint browser to show "Entire Screen" tab first
          displaySurface: "monitor",
        } as any,
        "auto",
      );

      let videoTrack: ILocalVideoTrack | null = null;
      let audioTrack: any = null;

      if (Array.isArray(t)) {
        [videoTrack, audioTrack] = t;
      } else {
        videoTrack = t as ILocalVideoTrack;
      }

      if (!videoTrack) {
        console.error("Screen share: no video track returned");
        return;
      }

      console.log("✅ Screen track created, audio:", !!audioTrack);

      // 1. Unpublish camera first so remote users see screen instead
      if (localCameraTrack) {
        try {
          await client.unpublish(localCameraTrack);
          console.log("✅ Camera unpublished for screen share");
        } catch (err) {
          console.warn("Unpublish camera error (non-fatal):", err);
        }
      }

      // 2. Publish screen tracks
      const tracksToPub: any[] = [videoTrack];
      if (audioTrack) tracksToPub.push(audioTrack);
      await client.publish(tracksToPub);
      console.log("✅ Screen tracks published to channel");

      const onEnded = () => stopScreenShareRef.current();
      videoTrack.on("track-ended", onEnded);

      setScreenTrack({
        videoTrack,
        audioTrack: audioTrack ?? undefined,
        _onEnded: onEnded,
      });
    } catch (err: any) {
      // User clicked "Cancel" on the browser's screen picker — not an error
      if (err?.name === "NotAllowedError" || err?.message?.includes("Permission denied")) {
        console.log("ℹ️ Screen share cancelled by user");
        return;
      }
      console.error("Screen share failed:", err);
      // If screen share failed mid-way, make sure camera is still published
      if (localCameraTrack) {
        try {
          await client.publish(localCameraTrack);
        } catch {}
      }
    }
  }

  // ─── Recording ────
  async function startRecording() {
    setRecordingError("");
    try {
      // ✅ FIX 3: Verify that at least one track is publishing
      if (!localCameraTrack?.enabled && !localMicrophoneTrack?.enabled) {
        throw new Error(
          "Cannot start recording: no audio/video tracks publishing. Please enable camera or microphone.",
        );
      }

      // ✅ Screen Share Recording: Pass screen share status to API
      // The API will use higher resolution (1280x720) for screen share
      // to ensure readable content in the recording
      const res = await fetch("/api/agora-recording/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelName,
          isScreenSharing: !!screenTrack,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const detailedError =
          errorData.setupInstructions ||
          errorData.details ||
          errorData.error ||
          `Recording start API returned ${res.status}`;
        throw new Error(detailedError);
      }
      const data = await res.json();
      if (!data.resourceId || !data.sid)
        throw new Error(
          "Invalid recording response: missing resourceId or sid",
        );
      setResourceId(data.resourceId);
      setSid(data.sid);
      setRecordingUid(data.recordingUid || "");
      setRecording(true);
      setRecordingStartTime(Date.now());
      setRecordingElapsed("00:00:00");
      console.log("✅ Recording started:", data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recording start failed";
      console.error("❌", msg);
      setRecordingError(msg);
    }
  }

  async function stopRecording() {
    setRecordingError("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8 second timeout (async_stop: true returns fast)

      const res = await fetch("/api/agora-recording/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, resourceId, sid, recordingUid }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(
          errorData.error || `Recording stop API returned ${res.status}`,
        );
      }

      const data = await res.json();
      console.log("✅ Recording stopped successfully:", data.message);
      setRecording(false);
      setRecordingStartTime(null);
      setRecordingElapsed("00:00:00");
      setResourceId("");
      setSid("");
      setRecordingUid("");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        const msg = "Recording stop timeout";
        console.error(msg);
        setRecordingError(msg);
        setRecording(false);
        setRecordingStartTime(null);
        setRecordingElapsed("00:00:00");
        setResourceId("");
        setSid("");
        setRecordingUid("");
      } else {
        const msg =
          err instanceof Error ? err.message : "Recording stop failed";
        console.error(msg);
        setRecordingError(msg);
      }
    }
  }

  const isLoading = !token || isLoadingMic || isLoadingCam;
  const total = remoteUsers.length + 1;
  const gridCols = total === 1 ? 1 : total <= 4 ? 2 : 3;

  function getInitials(name: string) {
    return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  }

  // ─── Lobby Screen (waiting for host approval) ─────────────────
  if (approvalStatus === "checking" || approvalStatus === "pending") {
    return (
      <div className='lobby-screen'>
        <style>{lobbyStyles}</style>
        <div className='lobby-card'>
          <div className='lobby-avatar' style={{ background: avatarColor }}>
            {getInitials(displayName)}
          </div>
          <h2 className='lobby-title'>
            {approvalStatus === "checking" ? "Connecting…" : "Waiting for approval"}
          </h2>
          <p className='lobby-sub'>
            {approvalStatus === "checking"
              ? "Setting up your connection…"
              : `The host (${hostName}) needs to approve your request to join.`}
          </p>
          <div className='lobby-spinner-wrap'>
            <span className='spinner' />
          </div>
          <button className='lobby-cancel-btn' onClick={() => router.push("/")}>
            ← Cancel and go back
          </button>
        </div>
      </div>
    );
  }

  // ─── Rejected Screen ──────────────────────────────────────────
  if (approvalStatus === "rejected") {
    return (
      <div className='lobby-screen'>
        <style>{lobbyStyles}</style>
        <div className='lobby-card'>
          <div className='lobby-rejected-icon'>✕</div>
          <h2 className='lobby-title' style={{ color: "#f87171" }}>Request Denied</h2>
          <p className='lobby-sub'>
            The host has denied your request to join this meeting.
          </p>
          <button className='lobby-cancel-btn' onClick={() => router.push("/")}>
            ← Back to home
          </button>
        </div>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className='error-screen'>
        <style>{errorStyles}</style>
        <p>Token error: {tokenError}</p>
        <p style={{ marginTop: "0.5rem", fontSize: "13px", color: "#6b6b85" }}>
          Make sure <code>AGORA_APP_CERTIFICATE</code> is set in{" "}
          <code>.env.local</code>.
        </p>
        <button onClick={() => router.push("/")} className='back-btn'>
          ← Go back
        </button>
      </div>
    );
  }

  return (
    <div className='call-root'>
      <style>{callStyles}</style>

      {/* Header */}
      <div className='call-header'>
        <div className='header-left'>
          <span className='live-badge'>
            <span className='live-dot' />
            LIVE
          </span>
          <span className='channel-name'># {channelName}</span>
          {meetingStartTime && (
            <span className='meeting-timer'>
              <ClockIcon /> {meetingElapsed}
            </span>
          )}
        </div>
        <div className='header-right'>
          {recording && (
            <span className='rec-badge'>
              <span className='rec-dot' />
              REC {recordingElapsed}
            </span>
          )}
          <span className='participant-count'>
            {total} participant{total !== 1 ? "s" : ""}
          </span>
          {isHost && <span className='host-badge'>HOST</span>}
        </div>
      </div>

      {/* Pending approval toasts (host only) */}
      {isHost && pendingRequests.length > 0 && (
        <div className='pending-toasts'>
          {pendingRequests.map((req) => (
            <div key={req.uid} className='pending-toast'>
              <div className='pending-toast-avatar' style={{ background: req.avatarColor || "#6366f1" }}>
                {getInitials(req.displayName)}
              </div>
              <div className='pending-toast-info'>
                <span className='pending-toast-name'>{req.displayName}</span>
                <span className='pending-toast-msg'>wants to join</span>
              </div>
              <div className='pending-toast-actions'>
                <button className='approve-btn' onClick={() => handleApproval(req.uid, "approve")}>✓ Admit</button>
                <button className='reject-btn' onClick={() => handleApproval(req.uid, "reject")}>✕ Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recording error banner */}
      {recordingError && (
        <div className='recording-error-banner'>
          ⚠ Recording error: {recordingError}
          <button onClick={() => setRecordingError("")}>✕</button>
        </div>
      )}

      {/* Video grid */}
      <div
        className='video-grid'
        style={{ "--cols": gridCols } as React.CSSProperties}
      >
        {isLoading ? (
          <div className='loading-tile'>
            <span className='spinner' />
            <p>{!token ? "Authenticating…" : "Starting devices…"}</p>
          </div>
        ) : (
          <>
            <div className='video-tile'>
              {screenTrack ? (
                <LocalVideoTrack
                  track={screenTrack.videoTrack}
                  play
                  className='video-track'
                />
              ) : (
                <LocalVideoTrack
                  track={localCameraTrack}
                  play={!camMuted}
                  className='video-track'
                />
              )}

              {camMuted && !screenTrack && (
                <div className='cam-off-overlay'>
                  <span className='avatar-initial' style={{ background: avatarColor, borderColor: avatarColor + "44" }}>
                    {getInitials(displayName)}
                  </span>
                </div>
              )}
              <span className='tile-label'>{displayName} {micMuted ? "🔇" : ""}</span>
              {screenTrack && (
                <span className='screen-share-badge'>Sharing screen</span>
              )}
            </div>

            {/* Remote users — RemoteUser handles subscribe + play automatically */}
            {remoteUsers.map((user) => {
              const rn = remoteNames[String(user.uid)];
              const remoteName = rn?.name || `User ${user.uid}`;
              const remoteColor = rn?.color || "#6366f1";
              return (
                <div
                  key={user.uid}
                  className={`video-tile ${activeSpeaker === Number(user.uid) ? "active-speaker" : ""}`}
                >
                  <RemoteUser
                    user={user}
                    playVideo={true}
                    playAudio={true}
                    style={{ width: "100%", height: "100%" }}
                  />
                  <span className='tile-label'>{remoteName}</span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {showSidebar && (
        <div className='sidebar'>
          <h3>Participants</h3>
          <ul>
            <li style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className='sidebar-avatar' style={{ background: avatarColor }}>{getInitials(displayName)}</span>
              {displayName} (You){isHost ? " ★" : ""}
            </li>
            {remoteUsers.map((u) => {
              const rn = remoteNames[String(u.uid)];
              const rName = rn?.name || `User ${u.uid}`;
              const rColor = rn?.color || "#6366f1";
              return (
                <li key={u.uid} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className='sidebar-avatar' style={{ background: rColor }}>{getInitials(rName)}</span>
                  {rName}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Controls bar */}
      <div className='controls-bar'>
        <button
          className={`ctrl-btn ${micMuted ? "ctrl-btn--off" : ""}`}
          onClick={toggleMic}
          title={micMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {micMuted ? <MicOffIcon /> : <MicIcon />}
          <span>{micMuted ? "Unmute" : "Mute"}</span>
        </button>

        <button
          className={`ctrl-btn ${camMuted ? "ctrl-btn--off" : ""}`}
          onClick={toggleCam}
          title={camMuted ? "Start camera" : "Stop camera"}
        >
          {camMuted ? <CamOffIcon /> : <CamIcon />}
          <span>{camMuted ? "Start cam" : "Stop cam"}</span>
        </button>

        <button
          onClick={screenTrack ? stopScreenShare : startScreenShare}
          className={`ctrl-btn ${screenTrack ? "ctrl-btn--off" : ""}`}
          title={screenTrack ? "Stop screen share" : "Share screen"}
        >
          {screenTrack ? <ScreenShareOnIcon /> : <ScreenShareOffIcon />}
          <span>{screenTrack ? "Stop" : "Share"}</span>
        </button>

        <button
          onClick={() => setShowSidebar((p) => !p)}
          className={`ctrl-btn ${showSidebar ? "ctrl-btn--off" : ""}`}
        >
          {showSidebar ? <HideUserIcon /> : <ShowUserIcon />}
          <span>{showSidebar ? "Hide" : "See"}</span>
        </button>

        <button
          onClick={recording ? stopRecording : startRecording}
          className={`ctrl-btn ${recording ? "ctrl-btn--off" : ""}`}
          title={recording ? "Stop recording" : "Start recording"}
        >
          {recording ? <DiscAlbum /> : <Disc2 />}
          <span>{recording ? "Stop Rec" : "Record"}</span>
        </button>

        <button className='ctrl-btn ctrl-btn--end' onClick={endCall}>
          <PhoneOffIcon />
          <span>End call</span>
        </button>
      </div>
    </div>
  );
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────
const ClockIcon = () => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
    <circle cx='12' cy='12' r='10' />
    <polyline points='12 6 12 12 16 14' />
  </svg>
);
const MicIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z' />
    <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
    <line x1='12' y1='19' x2='12' y2='22' />
    <line x1='8' y1='22' x2='16' y2='22' />
  </svg>
);
const MicOffIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <line x1='2' y1='2' x2='22' y2='22' />
    <path d='M18.89 13.23A7.12 7.12 0 0 0 19 12v-2' />
    <path d='M5 10v2a7 7 0 0 0 12 5' />
    <path d='M15 9.34V5a3 3 0 0 0-5.68-1.33' />
    <path d='M9 9v3a3 3 0 0 0 5.12 2.12' />
    <line x1='12' y1='19' x2='12' y2='22' />
    <line x1='8' y1='22' x2='16' y2='22' />
  </svg>
);
const CamIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <polygon points='23 7 16 12 23 17 23 7' />
    <rect x='1' y='5' width='15' height='14' rx='2' ry='2' />
  </svg>
);
const CamOffIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10' />
    <line x1='2' y1='2' x2='22' y2='22' />
  </svg>
);
const PhoneOffIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07' />
    <path d='M14.69 14.69A16 16 0 0 0 5.34 5.34' />
    <path d='M5.34 5.34a19.79 19.79 0 0 0-3.07 8.63A2 2 0 0 0 4.45 16.1a12.84 12.84 0 0 0 2.81-.7 2 2 0 0 1 2.11.45l1.27 1.27' />
    <line x1='2' y1='2' x2='22' y2='22' />
  </svg>
);
const ScreenShareOnIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <rect x='2' y='3' width='20' height='14' rx='2' />
    <line x1='12' y1='17' x2='12' y2='21' />
    <line x1='8' y1='21' x2='16' y2='21' />
    <polyline points='8 10 12 6 16 10' />
    <line x1='12' y1='6' x2='12' y2='14' />
  </svg>
);
const ScreenShareOffIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <rect x='2' y='3' width='20' height='14' rx='2' />
    <line x1='12' y1='17' x2='12' y2='21' />
    <line x1='8' y1='21' x2='16' y2='21' />
  </svg>
);
const ShowUserIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <circle cx='9' cy='7' r='3' />
    <path d='M3 21v-2a5 5 0 0 1 10 0v2' />
    <path d='M16 3.13a4 4 0 0 1 0 7.75' />
    <path d='M21 21v-2a5 5 0 0 0-3-4.65' />
  </svg>
);
const HideUserIcon = () => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <line x1='2' y1='2' x2='22' y2='22' />
    <circle cx='9' cy='7' r='3' />
    <path d='M3 21v-2a5 5 0 0 1 6.26-4.82' />
    <path d='M16 3.13a4 4 0 0 1 0 7.75' />
    <path d='M21 21v-2a5 5 0 0 0-3-4.65' />
  </svg>
);

// ─── Styles ───────────────────────────────────────────────────────────────────
const callStyles = `
.call-root {
  display: flex; flex-direction: column; height: 100vh;
  background: #07070d; font-family: 'DM Sans', 'Segoe UI', sans-serif;
  color: #e2e2f0; overflow: hidden;
}
.call-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.85rem 1.5rem; background: #0d0d16;
  border-bottom: 1px solid #1a1a28; flex-shrink: 0;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.live-badge {
  display: flex; align-items: center; gap: 5px;
  background: #2a1a2e; border: 1px solid #6366f130;
  border-radius: 6px; padding: 3px 8px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #a78bfa;
}
.live-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #a78bfa;
  animation: blink 1.2s ease-in-out infinite;
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
.channel-name { font-size: 15px; font-weight: 600; color: #c8c8e8; letter-spacing: 0.01em; }
.participant-count { font-size: 13px; color: #4a4a60; }

.recording-error-banner {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.5rem 1.5rem; background: #3a0f0f; color: #fca5a5;
  font-size: 13px; border-bottom: 1px solid #5a1a1a; flex-shrink: 0;
}
.recording-error-banner button {
  background: none; border: none; color: #f87171; cursor: pointer; font-size: 16px; padding: 0 4px;
}

.video-grid {
  flex: 1; display: grid;
  grid-template-columns: repeat(var(--cols, 1), 1fr);
  gap: 6px; padding: 6px; overflow: hidden;
}
.video-tile {
  position: relative; background: #111118;
  border-radius: 14px; overflow: hidden; border: 1px solid #1a1a28;
}
.video-track { width: 100%; height: 100%; object-fit: cover; }
.cam-off-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; background: #111118;
}
.avatar-initial {
  width: 64px; height: 64px; border-radius: 50%;
  background: #1e1e30; border: 1px solid #2e2e44;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; color: #6366f1;
}
.tile-label {
  position: absolute; bottom: 10px; left: 12px;
  font-size: 12px; font-weight: 500;
  color: rgba(255,255,255,0.8); background: rgba(0,0,0,0.45);
  backdrop-filter: blur(4px); padding: 3px 8px; border-radius: 6px;
}
.screen-share-badge {
  position: absolute; top: 10px; right: 12px;
  font-size: 11px; font-weight: 600; color: #a78bfa;
  background: rgba(99,102,241,0.15); border: 1px solid #6366f130;
  padding: 3px 8px; border-radius: 6px;
}
.loading-tile {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; height: 100%; color: #4a4a60; font-size: 14px;
}
.spinner {
  width: 28px; height: 28px;
  border: 2px solid #1e1e30; border-top-color: #6366f1;
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.controls-bar {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; padding: 1rem 1.5rem;
  background: #0d0d16; border-top: 1px solid #1a1a28; flex-shrink: 0;
}
.ctrl-btn {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  background: #161622; border: 1px solid #1e1e30; border-radius: 14px;
  padding: 0.7rem 1.2rem; color: #b0b0cc; cursor: pointer;
  font-family: inherit; font-size: 11px; font-weight: 500;
  transition: background 0.15s, border-color 0.15s, color 0.15s; min-width: 72px;
}
.ctrl-btn:hover { background: #1e1e2e; border-color: #2e2e44; color: #e2e2f0; }
.ctrl-btn--off { background: #1e1018; border-color: #3a1a22; color: #f87171; }
.ctrl-btn--off:hover { background: #2a1420; color: #fca5a5; }
.ctrl-btn--end { background: #3a0f0f; border-color: #5a1a1a; color: #f87171; }
.ctrl-btn--end:hover { background: #4a1414; color: #fca5a5; }

.active-speaker { border: 2px solid #22c55e; box-shadow: 0 0 12px #22c55e88; }

.sidebar {
  position: absolute; right: 0; top: 0; width: 240px; height: 100%;
  background: #0d0d16; border-left: 1px solid #1a1a28; padding: 1rem; z-index: 10;
}
.sidebar h3 { font-size: 14px; margin-bottom: 10px; }
.sidebar ul { list-style: none; padding: 0; font-size: 13px; }
.sidebar li { padding: 6px 0; border-bottom: 1px solid #1a1a28; }
.sidebar-avatar {
  width: 24px; height: 24px; border-radius: 50%; display: inline-flex;
  align-items: center; justify-content: center; font-size: 10px;
  font-weight: 700; color: #fff; flex-shrink: 0;
}

/* ─── Header extras ─── */
.header-right { display: flex; align-items: center; gap: 12px; }
.meeting-timer {
  display: flex; align-items: center; gap: 5px;
  font-size: 13px; font-weight: 600; color: #8888aa;
  background: #161622; border: 1px solid #1e1e30;
  border-radius: 6px; padding: 3px 8px; font-variant-numeric: tabular-nums;
}
.rec-badge {
  display: flex; align-items: center; gap: 5px;
  background: #3a0f0f; border: 1px solid #5a1a1a;
  border-radius: 6px; padding: 3px 10px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: #f87171;
  font-variant-numeric: tabular-nums;
}
.rec-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #f87171;
  animation: blink 1s ease-in-out infinite;
}
.host-badge {
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
  color: #eab308; background: #2a2400; border: 1px solid #3a3400;
  border-radius: 6px; padding: 3px 8px;
}

/* ─── Pending approval toasts ─── */
.pending-toasts {
  position: fixed; top: 70px; right: 20px; z-index: 100;
  display: flex; flex-direction: column; gap: 8px; max-width: 360px;
}
.pending-toast {
  display: flex; align-items: center; gap: 12px;
  background: #111118; border: 1px solid #1e1e2e; border-radius: 14px;
  padding: 12px 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  animation: slideIn 0.3s ease-out;
}
@keyframes slideIn {
  from { opacity: 0; transform: translateX(40px); }
  to { opacity: 1; transform: translateX(0); }
}
.pending-toast-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.pending-toast-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.pending-toast-name { font-size: 14px; font-weight: 600; color: #e2e2f0; }
.pending-toast-msg { font-size: 12px; color: #6b6b85; }
.pending-toast-actions { display: flex; gap: 6px; flex-shrink: 0; }
.approve-btn {
  background: #166534; border: 1px solid #22c55e40; border-radius: 8px;
  padding: 5px 12px; color: #86efac; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background 0.15s;
}
.approve-btn:hover { background: #15803d; }
.reject-btn {
  background: #3a0f0f; border: 1px solid #5a1a1a; border-radius: 8px;
  padding: 5px 12px; color: #fca5a5; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background 0.15s;
}
.reject-btn:hover { background: #4a1414; }
`;

const errorStyles = `
.error-screen {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: #07070d; font-family: 'DM Sans', 'Segoe UI', sans-serif;
  padding: 2rem; text-align: center; color: #f87171; font-size: 15px; line-height: 1.6;
}
.error-screen code { background: #1e1010; padding: 2px 6px; border-radius: 5px; font-size: 13px; }
.back-btn {
  margin-top: 1.5rem; background: #161622; border: 1px solid #1e1e30; border-radius: 10px;
  padding: 0.6rem 1.2rem; color: #b0b0cc; cursor: pointer; font-size: 14px; font-family: inherit;
}
.back-btn:hover { background: #1e1e2e; color: #e2e2f0; }
`;

const lobbyStyles = `
.lobby-screen {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #07070d; font-family: 'DM Sans', 'Segoe UI', sans-serif;
  padding: 2rem;
}
.lobby-card {
  width: 100%; max-width: 400px; background: #111118;
  border: 1px solid #1e1e2e; border-radius: 20px; padding: 2.5rem;
  text-align: center; animation: fadeIn 0.4s ease-out;
}
@keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.lobby-avatar {
  width: 72px; height: 72px; border-radius: 50%; margin: 0 auto 1.5rem;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 700; color: #fff;
  border: 3px solid rgba(255,255,255,0.1);
  box-shadow: 0 0 24px rgba(99,102,241,0.2);
}
.lobby-title { font-size: 1.4rem; font-weight: 700; color: #e2e2f0; margin: 0 0 0.5rem; }
.lobby-sub { font-size: 14px; color: #6b6b85; line-height: 1.6; margin: 0 0 1.5rem; }
.lobby-spinner-wrap { display: flex; justify-content: center; margin-bottom: 1.5rem; }
.lobby-spinner-wrap .spinner {
  width: 28px; height: 28px;
  border: 2px solid #1e1e30; border-top-color: #6366f1;
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.lobby-cancel-btn {
  background: #161622; border: 1px solid #1e1e30; border-radius: 10px;
  padding: 0.6rem 1.2rem; color: #b0b0cc; cursor: pointer;
  font-size: 14px; font-family: inherit; transition: background 0.15s, color 0.15s;
}
.lobby-cancel-btn:hover { background: #1e1e2e; color: #e2e2f0; }
.lobby-rejected-icon {
  width: 64px; height: 64px; border-radius: 50%;
  background: #3a0f0f; border: 2px solid #5a1a1a;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; color: #f87171; margin: 0 auto 1.5rem;
}
`;
