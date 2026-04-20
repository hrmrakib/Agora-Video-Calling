/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AgoraRTC, {
  AgoraRTCProvider,
  ILocalVideoTrack,
  LocalVideoTrack,
  RemoteUser,
  useJoin,
  useLocalCameraTrack,
  useLocalMicrophoneTrack,
  usePublish,
  useRemoteAudioTracks,
  useRemoteUsers,
} from "agora-rtc-react";
import { Disc2, DiscAlbum, User } from "lucide-react";

const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

interface VideoCallProps {
  channelName: string;
  appId: string;
}

// FIX 1: Typed screenTrack shape — stores the listener ref so we can remove it later
interface ScreenTrackState {
  videoTrack: ILocalVideoTrack;
  audioTrack?: any;
  _onEnded: () => void; // store so we can detach it on stop
}

export default function VideoCall({ channelName, appId }: VideoCallProps) {
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
      <CallUI channelName={channelName} appId={appId} />
    </AgoraRTCProvider>
  );
}

function CallUI({ channelName, appId }: VideoCallProps) {
  const router = useRouter();
  const [micMuted, setMicMuted] = useState(false);
  const [camMuted, setCamMuted] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  // FIX 1: Typed, consistent shape — null or ScreenTrackState
  const [screenTrack, setScreenTrack] = useState<ScreenTrackState | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<number | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState("");
  const [uid, setUid] = useState<number | null>(null);

  // FIX 4: recording error state added
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [sid, setSid] = useState("");

  // Active Speaker Detection
  useEffect(() => {
    client.enableAudioVolumeIndicator();
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

  useEffect(() => {
    if (localCameraTrack) return;
    navigator.mediaDevices.getUserMedia({ video: true }).catch((err) => {
      if (err.name === "NotReadableError") alert("Camera is already in use.");
      else if (err.name === "NotAllowedError")
        alert("Camera permission denied.");
    });
  }, [localCameraTrack]);

  const remoteUsers = useRemoteUsers();
  const { audioTracks } = useRemoteAudioTracks(remoteUsers);

  // FIX 2: usePublish — single publishing model, consistent array shape
  // When screen sharing: publish mic + screen video (+ screen audio if present)
  // When not: publish mic + camera (if available)
  // Camera is NEVER published while screen track is active
  usePublish(
    screenTrack
      ? screenTrack.audioTrack
        ? [
            localMicrophoneTrack!,
            screenTrack.videoTrack,
            screenTrack.audioTrack,
          ]
        : [localMicrophoneTrack!, screenTrack.videoTrack]
      : localCameraTrack
        ? [localMicrophoneTrack!, localCameraTrack]
        : [],
  );

  useJoin(
    { appid: appId, channel: channelName, token: token!, uid: uid! },
    !!token && !!uid,
  );

  useEffect(() => {
    audioTracks.forEach((track) => track.play());
  }, [audioTracks]);

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
      // FIX 3: Also clean up any active screen share on end call
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
      await client.leave();
    } catch (err) {
      console.error(err);
    } finally {
      router.push("/");
    }
  }

  // FIX 3: Store _onEnded ref so we can reliably remove the listener on stop
  async function startScreenShare() {
    try {
      const t = await AgoraRTC.createScreenVideoTrack(
        { encoderConfig: "1080p_1" },
        "enable",
      );

      let videoTrack: ILocalVideoTrack | null = null;
      let audioTrack: any = null;

      if (Array.isArray(t)) {
        [videoTrack, audioTrack] = t;
      } else {
        videoTrack = t as ILocalVideoTrack;
      }

      // Guard: createScreenVideoTrack should always return a video track
      if (!videoTrack) {
        console.error("Screen share: no video track returned");
        return;
      }

      // FIX 3: Named listener stored in state so stopScreenShare can remove it
      const onEnded = () => stopScreenShareRef.current();
      videoTrack.on("track-ended", onEnded);

      setScreenTrack({
        videoTrack,
        audioTrack: audioTrack ?? undefined,
        _onEnded: onEnded,
      });
    } catch (err) {
      // User cancelled the browser picker — not a real error
      if ((err as any)?.code !== "PERMISSION_DENIED") {
        console.error("Screen share error:", err);
      }
    }
  }

  async function stopScreenShare() {
    try {
      if (!screenTrack) return;

      const { videoTrack, audioTrack, _onEnded } = screenTrack;

      // FIX 3: Remove the track-ended listener before closing to prevent double-fire
      if (videoTrack && _onEnded) {
        try {
          videoTrack.off("track-ended", _onEnded);
        } catch {}
      }

      // FIX 3: Always stop() then close() to free the device
      if (videoTrack) {
        try {
          videoTrack.stop();
        } catch {}
        try {
          videoTrack.close();
        } catch {}
      }
      if (audioTrack) {
        try {
          audioTrack.stop();
        } catch {}
        try {
          audioTrack.close();
        } catch {}
      }

      // Clearing state triggers usePublish to re-publish camera automatically
      setScreenTrack(null);
    } catch (err) {
      console.error("Stop screen share error:", err);
    }
  }

  // FIX 3: Use a ref so the track-ended closure always calls the latest version
  // (avoids stale-closure issues with async state in the event handler)
  const stopScreenShareRef = { current: stopScreenShare };

  // FIX 4: Validate API response — require resourceId and sid before marking as recording
  async function startRecording() {
    setRecordingError("");
    try {
      const res = await fetch("/api/agora-recording/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, uid }),
      });

      if (!res.ok) {
        throw new Error(`Recording start API returned ${res.status}`);
      }

      const data = await res.json();

      if (!data.resourceId || !data.sid) {
        throw new Error(
          "Invalid recording response: missing resourceId or sid",
        );
      }

      setResourceId(data.resourceId);
      setSid(data.sid);
      setRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recording start failed";
      console.error(msg);
      setRecordingError(msg);
    }
  }

  // FIX 4: Validate stop response and clear state only on success
  async function stopRecording() {
    setRecordingError("");
    try {
      const res = await fetch("/api/agora-recording/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, uid, resourceId, sid }),
      });

      if (!res.ok) {
        throw new Error(`Recording stop API returned ${res.status}`);
      }

      setRecording(false);
      setResourceId("");
      setSid("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recording stop failed";
      console.error(msg);
      setRecordingError(msg);
    }
  }

  const isLoading = !token || isLoadingMic || isLoadingCam;
  const total = remoteUsers.length + 1;
  const gridCols = total === 1 ? 1 : total <= 4 ? 2 : 3;

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
        </div>
        <span className='participant-count'>
          {total} participant{total !== 1 ? "s" : ""}
        </span>
      </div>

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
              <LocalVideoTrack
                track={localCameraTrack}
                play={!camMuted && !screenTrack}
                className='video-track'
              />
              {/* Show screen share preview for local user */}
              {screenTrack && (
                <LocalVideoTrack
                  track={screenTrack.videoTrack}
                  play={true}
                  className='video-track'
                />
              )}
              {camMuted && !screenTrack && (
                <div className='cam-off-overlay'>
                  <span className='avatar-initial'>You</span>
                </div>
              )}
              <span className='tile-label'>You {micMuted ? "🔇" : ""}</span>
              {screenTrack && (
                <span className='screen-share-badge'>Sharing screen</span>
              )}
            </div>

            {remoteUsers.map((user) => (
              <div
                key={user.uid}
                className={`video-tile ${activeSpeaker === Number(user.uid) ? "active-speaker" : ""}`}
              >
                {user.videoTrack ? (
                  <RemoteUser user={user} className='video-track' />
                ) : (
                  <div className='cam-off-overlay'>
                    <span className='avatar-initial'>
                      {String(user.uid).slice(0, 2)}
                    </span>
                  </div>
                )}
                <span className='tile-label'>User {user.uid}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {showSidebar && (
        <div className='sidebar'>
          <h3>Participants</h3>
          <ul>
            <li>You ({uid})</li>
            {remoteUsers.map((u, inx: number) => (
              <li key={u.uid} className='flex items-center gap-1'>
                {inx + 1}: <User size={16} /> User {u.uid}
              </li>
            ))}
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

// /* eslint-disable @typescript-eslint/no-explicit-any */
// "use client";

// import { useEffect, useState } from "react";
// import { useRouter } from "next/navigation";
// import AgoraRTC, {
//   AgoraRTCProvider,
//   ILocalVideoTrack,
//   LocalVideoTrack,
//   RemoteUser,
//   useJoin,
//   useLocalCameraTrack,
//   useLocalMicrophoneTrack,
//   usePublish,
//   useRemoteAudioTracks,
//   useRemoteUsers,
// } from "agora-rtc-react";
// import { Disc2, DiscAlbum, User } from "lucide-react";

// const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

// interface VideoCallProps {
//   channelName: string;
//   appId: string;
// }

// export default function VideoCall({ channelName, appId }: VideoCallProps) {
//   if (!appId) {
//     return (
//       <div className='error-screen'>
//         <p>
//           <strong>Missing Agora App ID.</strong> Add{" "}
//           <code>NEXT_PUBLIC_AGORA_APP_ID</code> to your <code>.env.local</code>{" "}
//           and restart the dev server.
//         </p>
//         <style>{errorStyles}</style>
//       </div>
//     );
//   }

//   return (
//     <AgoraRTCProvider client={client}>
//       <CallUI channelName={channelName} appId={appId} />
//     </AgoraRTCProvider>
//   );
// }

// function CallUI({ channelName, appId }: VideoCallProps) {
//   const router = useRouter();
//   const [micMuted, setMicMuted] = useState(false);
//   const [camMuted, setCamMuted] = useState(false);
//   //
//   const [showSidebar, setShowSidebar] = useState(false);
//   const [screenTrack, setScreenTrack] = useState<any>(null);
//   const [activeSpeaker, setActiveSpeaker] = useState<number | null>(null);

//   // ── Token state ────────────────────────────────────────────────────────────
//   const [token, setToken] = useState<string | null>(null);
//   const [tokenError, setTokenError] = useState("");
//   const [uid, setUid] = useState<number | null>(null);

//   const [recording, setRecording] = useState(false);
//   const [resourceId, setResourceId] = useState("");
//   const [sid, setSid] = useState("");

//   // Active Speaker Detection
//   useEffect(() => {
//     client.enableAudioVolumeIndicator();

//     const handler = (volumes: any[]) => {
//       const active = volumes.find((v) => v.level > 50);
//       if (active) setActiveSpeaker(Number(active.uid));
//     };

//     client.on("volume-indicator", handler);

//     return () => {
//       client.off("volume-indicator", handler);
//     };
//   }, []);

//   // get token
//   useEffect(() => {
//     async function fetchToken() {
//       try {
//         const res = await fetch(
//           `/api/agora-token?channelName=${encodeURIComponent(channelName)}`,
//         );
//         if (!res.ok) {
//           const body = await res.json();
//           throw new Error(body.error ?? "Failed to fetch token");
//         }
//         const { token, uid } = await res.json();
//         setUid(uid);
//         setToken(token);
//       } catch (err) {
//         setTokenError(err instanceof Error ? err.message : "Unknown error");
//       }
//     }
//     fetchToken();
//   }, [channelName]);

//   // ── Agora hooks ────────────────────────────────────────────────────────────
//   const { isLoading: isLoadingMic, localMicrophoneTrack } =
//     useLocalMicrophoneTrack(true);

//   const { isLoading: isLoadingCam, localCameraTrack } =
//     useLocalCameraTrack(true);

//   // Cam/Mic START manually AFTER join
//   useEffect(() => {
//     if (token && uid && localCameraTrack && localMicrophoneTrack) {
//       localCameraTrack.setEnabled(true).catch(console.error);
//       localMicrophoneTrack.setEnabled(true).catch(console.error);
//     }
//   }, [token, uid, localCameraTrack, localMicrophoneTrack]);

//   // Handle Camera Errors
//   useEffect(() => {
//     if (localCameraTrack) return;

//     navigator.mediaDevices.getUserMedia({ video: true }).catch((err) => {
//       console.error("Camera access failed:", err);

//       if (err.name === "NotReadableError") {
//         alert("Camera is already in use.");
//       } else if (err.name === "NotAllowedError") {
//         alert("Camera permission denied.");
//       }
//     });
//   }, [localCameraTrack]);

//   const remoteUsers = useRemoteUsers();
//   const { audioTracks } = useRemoteAudioTracks(remoteUsers);

//   usePublish(
//     screenTrack
//       ? // screenTrack is {videoTrack, audioTrack}
//         screenTrack.audioTrack
//         ? [
//             localMicrophoneTrack!,
//             screenTrack.videoTrack,
//             screenTrack.audioTrack,
//           ]
//         : [localMicrophoneTrack!, screenTrack.videoTrack]
//       : localCameraTrack
//         ? [localMicrophoneTrack!, localCameraTrack]
//         : [],
//   );

//   // Only join once the token is ready
//   useJoin(
//     { appid: appId, channel: channelName, token: token!, uid: uid! },
//     !!token && !!uid, // <— "ready" flag: Agora won't try to join until this is true
//   );

//   useEffect(() => {
//     audioTracks.forEach((track) => track.play());
//   }, [audioTracks]);

//   async function toggleMic() {
//     await localMicrophoneTrack?.setMuted(!micMuted);
//     setMicMuted((prev) => !prev);
//   }

//   async function toggleCam() {
//     await localCameraTrack?.setMuted(!camMuted);
//     setCamMuted((prev) => !prev);
//   }

//   async function endCall() {
//     try {
//       localMicrophoneTrack?.close();
//       localCameraTrack?.close();
//       await client.leave();
//     } catch (err) {
//       console.error(err);
//     } finally {
//       router.push("/");
//     }
//   }

//   // Screen Sharing
//   async function startScreenShare() {
//     try {
//       // createScreenVideoTrack can return VideoTrack or [VideoTrack, AudioTrack]
//       const t = await AgoraRTC.createScreenVideoTrack(
//         { encoderConfig: "1080p_1" },
//         "enable",
//       );

//       let videoTrack: ILocalVideoTrack | null = null;
//       let audioTrack: any = null;

//       if (Array.isArray(t)) {
//         [videoTrack, audioTrack] = t;
//       } else {
//         videoTrack = t as ILocalVideoTrack;
//       }

//       // When user stops via browser UI
//       videoTrack.on("track-ended", stopScreenShare);

//       // Store as an object so usePublish receives same reference
//       setScreenTrack({ videoTrack, audioTrack });
//     } catch (err) {
//       console.error("Screen share error:", err);
//     }
//   }

//   async function stopScreenShare() {
//     try {
//       if (!screenTrack) return;

//       const { videoTrack, audioTrack } = screenTrack as {
//         videoTrack: ILocalVideoTrack | null;
//         audioTrack?: any | null;
//       };

//       // close and stop local tracks
//       if (videoTrack) {
//         try {
//           videoTrack.stop();
//         } catch {}
//         try {
//           videoTrack.close();
//         } catch {}
//       }
//       if (audioTrack) {
//         try {
//           audioTrack.stop();
//         } catch {}
//         try {
//           audioTrack.close();
//         } catch {}
//       }

//       // clear state — usePublish will re-publish camera automatically
//       setScreenTrack(null);
//     } catch (err) {
//       console.error("Stop screen share error:", err);
//     }
//   }

//   // recording

//   async function startRecording() {
//     const res = await fetch("/api/agora-recording/start", {
//       method: "POST",
//       body: JSON.stringify({
//         channelName,
//         uid,
//       }),
//     });

//     const data = await res.json();

//     setResourceId(data.resourceId);
//     setSid(data.sid);
//     setRecording(true);
//   }

//   async function stopRecording() {
//     await fetch("/api/agora-recording/stop", {
//       method: "POST",
//       body: JSON.stringify({
//         channelName,
//         uid,
//         resourceId,
//         sid,
//       }),
//     });

//     setRecording(false);
//   }

//   const isLoading = !token || isLoadingMic || isLoadingCam;
//   const total = remoteUsers.length + 1;
//   const gridCols = total === 1 ? 1 : total <= 4 ? 2 : 3;

//   if (tokenError) {
//     return (
//       <div className='error-screen'>
//         <p>
//           <strong>Token error:</strong> {tokenError}
//         </p>
//         <p style={{ marginTop: "0.5rem", fontSize: "13px", color: "#6b6b85" }}>
//           Make sure <code>AGORA_APP_CERTIFICATE</code> is set in{" "}
//           <code>.env.local</code>.
//         </p>
//         <button onClick={() => router.push("/")} className='back-btn'>
//           ← Go back
//         </button>
//         <style>{errorStyles}</style>
//       </div>
//     );
//   }

//   return (
//     <div className='call-root'>
//       {/* Header */}
//       <header className='call-header'>
//         <div className='header-left'>
//           <span className='live-badge'>
//             <span className='live-dot' />
//             LIVE
//           </span>
//           <span className='channel-name'># {channelName}</span>
//         </div>
//         <div className='header-right'>
//           <span className='participant-count'>
//             {total} participant{total !== 1 ? "s" : ""}
//           </span>
//         </div>
//       </header>

//       {/* Video grid */}
//       <div
//         className='video-grid'
//         style={{ "--cols": gridCols } as React.CSSProperties}
//       >
//         {isLoading ? (
//           <div className='loading-tile'>
//             <span className='spinner' />
//             <p>{!token ? "Authenticating…" : "Starting devices…"}</p>
//           </div>
//         ) : (
//           <>
//             <div className='video-tile'>
//               <LocalVideoTrack
//                 track={localCameraTrack}
//                 play={!camMuted}
//                 className='video-track'
//               />
//               {camMuted && (
//                 <div className='cam-off-overlay'>
//                   <span className='avatar-initial'>You</span>
//                 </div>
//               )}
//               <span className='tile-label'>You {micMuted ? "🔇" : ""}</span>
//             </div>

//             {remoteUsers.map((user) => (
//               <div key={user.uid} className='video-tile'>
//                 {user.videoTrack ? (
//                   <RemoteUser user={user} className='video-track' />
//                 ) : (
//                   <div className='cam-off-overlay'>
//                     <span className='avatar-initial'>User</span>
//                   </div>
//                 )}
//                 <span className='tile-label'>User {user.uid}</span>
//               </div>
//             ))}
//           </>
//         )}
//       </div>

//       {showSidebar && (
//         <div className='sidebar'>
//           <h3>Participants</h3>
//           <ul>
//             <li>You ({uid})</li>
//             {remoteUsers.map((u, inx: number) => (
//               <li key={u.uid} className='flex items-center gap-1'>
//                 {inx + 1}: <User size={16} />
//                 User {u.uid}
//               </li>
//             ))}
//           </ul>
//         </div>
//       )}

//       {/* Controls bar */}
//       <div className='controls-bar'>
//         <button
//           className={`ctrl-btn ${micMuted ? "ctrl-btn--off" : ""}`}
//           onClick={toggleMic}
//           title={micMuted ? "Unmute microphone" : "Mute microphone"}
//         >
//           {micMuted ? <MicOffIcon /> : <MicIcon />}
//           <span>{micMuted ? "Unmute" : "Mute"}</span>
//         </button>

//         <button
//           className={`ctrl-btn ${camMuted ? "ctrl-btn--off" : ""}`}
//           onClick={toggleCam}
//           title={camMuted ? "Start camera" : "Stop camera"}
//         >
//           {camMuted ? <CamOffIcon /> : <CamIcon />}
//           <span>{camMuted ? "Start cam" : "Stop cam"}</span>
//         </button>

//         <button
//           onClick={screenTrack ? stopScreenShare : startScreenShare}
//           className={`ctrl-btn ${screenTrack ? "ctrl-btn--off" : ""}`}
//         >
//           {screenTrack ? <ScreenShareOnIcon /> : <ScreenShareOffIcon />}
//           <span>{screenTrack ? "Stop" : "Share"}</span>
//         </button>

//         <button
//           onClick={() => setShowSidebar((p) => !p)}
//           className={`ctrl-btn ${showSidebar ? "ctrl-btn--off" : ""}`}
//         >
//           {showSidebar ? <HideUserIcon /> : <ShowUserIcon />}
//           <span>{showSidebar ? "Hide" : "See"}</span>
//         </button>

//         <button
//           onClick={recording ? stopRecording : startRecording}
//           className={`ctrl-btn ${recording ? "ctrl-btn--off" : ""}`}
//         >
//           {recording ? <DiscAlbum /> : <Disc2 />}
//           <span>{recording ? "Stop Rec" : "Record"}</span>
//         </button>

//         <button className='ctrl-btn ctrl-btn--end' onClick={endCall}>
//           <PhoneOffIcon />
//           <span>End call</span>
//         </button>
//       </div>

//       <style>{callStyles}</style>
//     </div>
//   );
// }

// // ─── SVG Icons ────────────────────────────────────────────────────────────────
// const MicIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <path d='M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z' />
//     <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
//     <line x1='12' y1='19' x2='12' y2='22' />
//     <line x1='8' y1='22' x2='16' y2='22' />
//   </svg>
// );

// const MicOffIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <line x1='2' y1='2' x2='22' y2='22' />
//     <path d='M18.89 13.23A7.12 7.12 0 0 0 19 12v-2' />
//     <path d='M5 10v2a7 7 0 0 0 12 5' />
//     <path d='M15 9.34V5a3 3 0 0 0-5.68-1.33' />
//     <path d='M9 9v3a3 3 0 0 0 5.12 2.12' />
//     <line x1='12' y1='19' x2='12' y2='22' />
//     <line x1='8' y1='22' x2='16' y2='22' />
//   </svg>
// );

// const CamIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <polygon points='23 7 16 12 23 17 23 7' />
//     <rect x='1' y='5' width='15' height='14' rx='2' ry='2' />
//   </svg>
// );

// const CamOffIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <path d='M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10' />
//     <line x1='2' y1='2' x2='22' y2='22' />
//   </svg>
// );

// const PhoneOffIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <path d='M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07' />
//     <path d='M14.69 14.69A16 16 0 0 0 5.34 5.34' />
//     <path d='M5.34 5.34a19.79 19.79 0 0 0-3.07 8.63A2 2 0 0 0 4.45 16.1a12.84 12.84 0 0 0 2.81-.7 2 2 0 0 1 2.11.45l1.27 1.27' />
//     <line x1='2' y1='2' x2='22' y2='22' />
//   </svg>
// );

// const ScreenShareOnIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <rect x='2' y='3' width='20' height='14' rx='2' />
//     <line x1='12' y1='17' x2='12' y2='21' />
//     <line x1='8' y1='21' x2='16' y2='21' />
//     <polyline points='8 10 12 6 16 10' />
//     <line x1='12' y1='6' x2='12' y2='14' />
//   </svg>
// );

// const ScreenShareOffIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <line x1='2' y1='2' x2='22' y2='22' />
//     <path d='M7.2 3H22a2 2 0 0 1 2 2v10a2 2 0 0 1-1.18 1.82' />
//     <path d='M2 8.5V5a2 2 0 0 1 .5-1.31' />
//     <path d='M2 13V5' />
//     <rect x='2' y='3' width='20' height='14' rx='2' />
//     <line x1='12' y1='17' x2='12' y2='21' />
//     <line x1='8' y1='21' x2='16' y2='21' />
//   </svg>
// );

// const ShowUserIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <circle cx='9' cy='7' r='3' />
//     <path d='M3 21v-2a5 5 0 0 1 10 0v2' />
//     <path d='M16 3.13a4 4 0 0 1 0 7.75' />
//     <path d='M21 21v-2a5 5 0 0 0-3-4.65' />
//   </svg>
// );

// const HideUserIcon = () => (
//   <svg
//     width='20'
//     height='20'
//     viewBox='0 0 24 24'
//     fill='none'
//     stroke='currentColor'
//     strokeWidth='1.8'
//     strokeLinecap='round'
//     strokeLinejoin='round'
//   >
//     <line x1='2' y1='2' x2='22' y2='22' />
//     <circle cx='9' cy='7' r='3' />
//     <path d='M3 21v-2a5 5 0 0 1 6.26-4.82' />
//     <path d='M16 3.13a4 4 0 0 1 0 7.75' />
//     <path d='M21 21v-2a5 5 0 0 0-3-4.65' />
//   </svg>
// );

// // ─── Styles ───────────────────────────────────────────────────────────────────
// const callStyles = `
//   .call-root {
//     display: flex;
//     flex-direction: column;
//     height: 100vh;
//     background: #07070d;
//     font-family: 'DM Sans', 'Segoe UI', sans-serif;
//     color: #e2e2f0;
//     overflow: hidden;
//   }
//   .call-header {
//     display: flex;
//     align-items: center;
//     justify-content: space-between;
//     padding: 0.85rem 1.5rem;
//     background: #0d0d16;
//     border-bottom: 1px solid #1a1a28;
//     flex-shrink: 0;
//   }
//   .header-left { display: flex; align-items: center; gap: 12px; }
//   .live-badge {
//     display: flex; align-items: center; gap: 5px;
//     background: #2a1a2e; border: 1px solid #6366f130;
//     border-radius: 6px; padding: 3px 8px;
//     font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #a78bfa;
//   }
//   .live-dot {
//     width: 6px; height: 6px; border-radius: 50%; background: #a78bfa;
//     animation: blink 1.2s ease-in-out infinite;
//   }
//   @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
//   .channel-name { font-size: 15px; font-weight: 600; color: #c8c8e8; letter-spacing: 0.01em; }
//   .participant-count { font-size: 13px; color: #4a4a60; }
//   .video-grid {
//     flex: 1; display: grid;
//     grid-template-columns: repeat(var(--cols, 1), 1fr);
//     gap: 6px; padding: 6px; overflow: hidden;
//   }
//   .video-tile {
//     position: relative; background: #111118;
//     border-radius: 14px; overflow: hidden; border: 1px solid #1a1a28;
//   }
//   .video-track { width: 100%; height: 100%; object-fit: cover; }
//   .cam-off-overlay {
//     position: absolute; inset: 0;
//     display: flex; align-items: center; justify-content: center; background: #111118;
//   }
//   .avatar-initial {
//     width: 64px; height: 64px; border-radius: 50%;
//     background: #1e1e30; border: 1px solid #2e2e44;
//     display: flex; align-items: center; justify-content: center;
//     font-size: 14px; font-weight: 600; color: #6366f1;
//   }
//   .tile-label {
//     position: absolute; bottom: 10px; left: 12px;
//     font-size: 12px; font-weight: 500;
//     color: rgba(255,255,255,0.8); background: rgba(0,0,0,0.45);
//     backdrop-filter: blur(4px); padding: 3px 8px; border-radius: 6px;
//   }
//   .loading-tile {
//     display: flex; flex-direction: column;
//     align-items: center; justify-content: center;
//     gap: 12px; height: 100%; color: #4a4a60; font-size: 14px;
//   }
//   .spinner {
//     width: 28px; height: 28px;
//     border: 2px solid #1e1e30; border-top-color: #6366f1;
//     border-radius: 50%; animation: spin 0.8s linear infinite;
//   }
//   @keyframes spin { to { transform: rotate(360deg); } }
//   .controls-bar {
//     display: flex; align-items: center; justify-content: center;
//     gap: 10px; padding: 1rem 1.5rem;
//     background: #0d0d16; border-top: 1px solid #1a1a28; flex-shrink: 0;
//   }
//   .ctrl-btn {
//     display: flex; flex-direction: column; align-items: center; gap: 4px;
//     background: #161622; border: 1px solid #1e1e30; border-radius: 14px;
//     padding: 0.7rem 1.2rem; color: #b0b0cc; cursor: pointer;
//     font-family: inherit; font-size: 11px; font-weight: 500;
//     transition: background 0.15s, border-color 0.15s, color 0.15s; min-width: 72px;
//   }
//   .ctrl-btn:hover { background: #1e1e2e; border-color: #2e2e44; color: #e2e2f0; }
//   .ctrl-btn--off { background: #1e1018; border-color: #3a1a22; color: #f87171; }
//   .ctrl-btn--off:hover { background: #2a1420; color: #fca5a5; }
//   .ctrl-btn--end { background: #3a0f0f; border-color: #5a1a1a; color: #f87171; }
//   .ctrl-btn--end:hover { background: #4a1414; color: #fca5a5; }

//   .active-speaker {
//   border: 2px solid #22c55e;
//   box-shadow: 0 0 12px #22c55e88;
// }

//   .sidebar {
//     position: absolute;
//     right: 0;
//     top: 0;
//     width: 240px;
//     height: 100%;
//     background: #0d0d16;
//     border-left: 1px solid #1a1a28;
//     padding: 1rem;
//   }

//   .sidebar h3 {
//     font-size: 14px;
//     margin-bottom: 10px;
//   }

//   .sidebar ul {
//     list-style: none;
//     padding: 0;
//     font-size: 13px;
//   }

//   .end-call {
//     background: red;
//   }
// `;

// const errorStyles = `
//   .error-screen {
//     min-height: 100vh; display: flex; flex-direction: column;
//     align-items: center; justify-content: center;
//     background: #07070d; font-family: 'DM Sans', 'Segoe UI', sans-serif;
//     padding: 2rem; text-align: center; color: #f87171;
//     font-size: 15px; line-height: 1.6;
//   }
//   .error-screen code { background: #1e1010; padding: 2px 6px; border-radius: 5px; font-size: 13px; }
//   .back-btn {
//     margin-top: 1.5rem; background: #161622; border: 1px solid #1e1e30;
//     border-radius: 10px; padding: 0.6rem 1.2rem; color: #b0b0cc;
//     cursor: pointer; font-size: 14px; font-family: inherit;
//   }
//   .back-btn:hover { background: #1e1e2e; color: #e2e2f0; }
// `;
