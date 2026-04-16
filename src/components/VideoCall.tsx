"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AgoraRTC, {
  AgoraRTCProvider,
  LocalVideoTrack,
  RemoteUser,
  useJoin,
  useLocalCameraTrack,
  useLocalMicrophoneTrack,
  usePublish,
  useRemoteAudioTracks,
  useRemoteUsers,
} from "agora-rtc-react";

const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

interface VideoCallProps {
  channelName: string;
  appId: string;
}

export default function VideoCall({ channelName, appId }: VideoCallProps) {
  if (!appId) {
    return (
      <div className='error-screen'>
        <p>
          <strong>Missing Agora App ID.</strong> Add{" "}
          <code>NEXT_PUBLIC_AGORA_APP_ID</code> to your <code>.env.local</code>{" "}
          and restart the dev server.
        </p>
        <style>{errorStyles}</style>
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

  // ── Token state ────────────────────────────────────────────────────────────
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState("");
  const [uid, setUid] = useState<number | null>(null);

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

  // ── Agora hooks ────────────────────────────────────────────────────────────
  const { isLoading: isLoadingMic, localMicrophoneTrack } =
    useLocalMicrophoneTrack(true);

  const { isLoading: isLoadingCam, localCameraTrack } =
    useLocalCameraTrack(true);

  // Cam/Mic START manually AFTER join
  useEffect(() => {
    if (token && uid && localCameraTrack && localMicrophoneTrack) {
      localCameraTrack.setEnabled(true).catch(console.error);
      localMicrophoneTrack.setEnabled(true).catch(console.error);
    }
  }, [token, uid, localCameraTrack, localMicrophoneTrack]);

  // Handle Camera Errors
  useEffect(() => {
    if (localCameraTrack) return;

    navigator.mediaDevices.getUserMedia({ video: true }).catch((err) => {
      console.error("Camera access failed:", err);

      if (err.name === "NotReadableError") {
        alert("Camera is already in use.");
      } else if (err.name === "NotAllowedError") {
        alert("Camera permission denied.");
      }
    });
  }, [localCameraTrack]);

  const remoteUsers = useRemoteUsers();
  const { audioTracks } = useRemoteAudioTracks(remoteUsers);

  // usePublish([localMicrophoneTrack, localCameraTrack]);
  usePublish(
    localMicrophoneTrack && localCameraTrack
      ? [localMicrophoneTrack, localCameraTrack]
      : [],
  );

  // Only join once the token is ready
  useJoin(
    { appid: appId, channel: channelName, token: token!, uid: uid! },
    !!token && !!uid, // <— "ready" flag: Agora won't try to join until this is true
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
      localMicrophoneTrack?.close();
      localCameraTrack?.close();
      await client.leave();
    } catch (err) {
      console.error(err);
    } finally {
      router.push("/");
    }
  }

  const isLoading = !token || isLoadingMic || isLoadingCam;
  const total = remoteUsers.length + 1;
  const gridCols = total === 1 ? 1 : total <= 4 ? 2 : 3;

  if (tokenError) {
    return (
      <div className='error-screen'>
        <p>
          <strong>Token error:</strong> {tokenError}
        </p>
        <p style={{ marginTop: "0.5rem", fontSize: "13px", color: "#6b6b85" }}>
          Make sure <code>AGORA_APP_CERTIFICATE</code> is set in{" "}
          <code>.env.local</code>.
        </p>
        <button onClick={() => router.push("/")} className='back-btn'>
          ← Go back
        </button>
        <style>{errorStyles}</style>
      </div>
    );
  }

  return (
    <div className='call-root'>
      {/* Header */}
      <header className='call-header'>
        <div className='header-left'>
          <span className='live-badge'>
            <span className='live-dot' />
            LIVE
          </span>
          <span className='channel-name'># {channelName}</span>
        </div>
        <div className='header-right'>
          <span className='participant-count'>
            {total} participant{total !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

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
                play={!camMuted}
                className='video-track'
              />
              {camMuted && (
                <div className='cam-off-overlay'>
                  <span className='avatar-initial'>You</span>
                </div>
              )}
              <span className='tile-label'>You {micMuted ? "🔇" : ""}</span>
            </div>

            {remoteUsers.map((user) => (
              <div key={user.uid} className='video-tile'>
                {/* <RemoteUser user={user} className='video-track' /> */}
                {user.videoTrack ? (
                  <RemoteUser user={user} className='video-track' />
                ) : (
                  <div className='cam-off-overlay'>
                    <span className='avatar-initial'>User</span>
                  </div>
                )}
                <span className='tile-label'>User {user.uid}</span>
              </div>
            ))}
          </>
        )}
      </div>

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

        <button className='ctrl-btn ctrl-btn--end' onClick={endCall}>
          <PhoneOffIcon />
          <span>End call</span>
        </button>
      </div>

      <style>{callStyles}</style>
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

// ─── Styles ───────────────────────────────────────────────────────────────────
const callStyles = `
  .call-root {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #07070d;
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
    color: #e2e2f0;
    overflow: hidden;
  }
  .call-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.5rem;
    background: #0d0d16;
    border-bottom: 1px solid #1a1a28;
    flex-shrink: 0;
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
`;

const errorStyles = `
  .error-screen {
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: #07070d; font-family: 'DM Sans', 'Segoe UI', sans-serif;
    padding: 2rem; text-align: center; color: #f87171;
    font-size: 15px; line-height: 1.6;
  }
  .error-screen code { background: #1e1010; padding: 2px 6px; border-radius: 5px; font-size: 13px; }
  .back-btn {
    margin-top: 1.5rem; background: #161622; border: 1px solid #1e1e30;
    border-radius: 10px; padding: 0.6rem 1.2rem; color: #b0b0cc;
    cursor: pointer; font-size: 14px; font-family: inherit;
  }
  .back-btn:hover { background: #1e1e2e; color: #e2e2f0; }
`;
