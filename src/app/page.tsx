/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useGetUserProfileQuery } from "@/redux/features/user/userAPI";

const AVATAR_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
];

export default function Home() {
  const router = useRouter();
  const [channelName, setChannelName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [error, setError] = useState("");

  const {} = useGetUserProfileQuery(undefined, { skip: true });

  // Restore saved name & color from localStorage
  useEffect(() => {
    const savedName = localStorage.getItem("liveroom_displayName");
    const savedColor = localStorage.getItem("liveroom_avatarColor");
    if (savedName) setDisplayName(savedName);
    if (savedColor && AVATAR_COLORS.includes(savedColor))
      setAvatarColor(savedColor);
  }, []);

  function getInitials(name: string) {
    return name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError("Please enter your display name.");
      return;
    }

    const trimmedChannel = channelName.trim();
    if (!trimmedChannel) {
      setError("Please enter a channel name.");
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedChannel)) {
      setError("Only letters, numbers, hyphens, and underscores are allowed.");
      return;
    }

    // Persist to localStorage
    localStorage.setItem("liveroom_displayName", trimmedName);
    localStorage.setItem("liveroom_avatarColor", avatarColor);

    // Navigate with profile params
    const params = new URLSearchParams({
      name: trimmedName,
      color: avatarColor,
    });
    router.push(
      `/channel/${encodeURIComponent(trimmedChannel)}?${params.toString()}`,
    );
  }

  return (
    <main className='join-page'>
      <div className='join-card'>
        <div className='logo-row'>
          <span className='logo-dot' />
          <span className='brand'>LiveRoom</span>
        </div>

        <h1 className='headline'>
          Start or join a<br />
          <span className='headline-accent'>video call</span>
        </h1>

        <p className='subline'>
          Set your name, pick an avatar, and enter a channel to get started.
        </p>

        <form onSubmit={handleSubmit} className='join-form'>
          {/* ─── Display Name ─── */}
          <label htmlFor='displayName' className='field-label'>
            Your name
          </label>
          <div className='input-row'>
            <input
              id='displayName'
              type='text'
              placeholder='e.g. John Doe'
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setError("");
              }}
              className='channel-input'
              autoComplete='name'
              spellCheck={false}
              maxLength={30}
            />
          </div>

          {/* ─── Avatar Color Picker ─── */}
          <label className='field-label' style={{ marginTop: "12px" }}>
            Avatar color <span className='optional-tag'>(optional)</span>
          </label>
          <div className='avatar-picker'>
            <div className='avatar-preview' style={{ background: avatarColor }}>
              {displayName.trim() ? getInitials(displayName) : "?"}
            </div>
            <div className='color-grid'>
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type='button'
                  className={`color-swatch ${avatarColor === color ? "color-swatch--active" : ""}`}
                  style={{ background: color }}
                  onClick={() => setAvatarColor(color)}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* ─── Channel Name ─── */}
          <label
            htmlFor='channelName'
            className='field-label'
            style={{ marginTop: "12px" }}
          >
            Channel name
          </label>
          <div className='input-row'>
            <input
              id='channelName'
              type='text'
              placeholder='e.g. team-standup'
              value={channelName}
              onChange={(e) => {
                setChannelName(e.target.value);
                setError("");
              }}
              className='channel-input'
              autoComplete='off'
              spellCheck={false}
            />
          </div>

          {error && <p className='error-msg'>{error}</p>}

          <button type='submit' className='join-btn'>
            Join room
            <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
              <path
                d='M3 8h10M9 4l4 4-4 4'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          </button>
        </form>

        <p className='hint'>
          No account needed &mdash; just pick a name and share the channel with
          others.
        </p>
      </div>

      <style>{`
        .join-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0a0a0f;
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          padding: 2rem;
        }

        .join-card {
          width: 100%;
          max-width: 440px;
          background: #111118;
          border: 1px solid #1e1e2e;
          border-radius: 20px;
          padding: 2.5rem;
        }

        .logo-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 2.5rem;
        }

        .logo-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #6366f1;
          box-shadow: 0 0 8px #6366f1aa;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .brand {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #e2e2f0;
        }

        .headline {
          font-size: 2rem;
          font-weight: 700;
          line-height: 1.2;
          color: #f0f0fa;
          margin: 0 0 0.75rem;
          letter-spacing: -0.02em;
        }

        .headline-accent {
          color: #6366f1;
        }

        .subline {
          font-size: 14px;
          color: #6b6b85;
          line-height: 1.6;
          margin: 0 0 2rem;
        }

        .join-form {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #5a5a74;
          margin-bottom: 4px;
        }

        .optional-tag {
          text-transform: none;
          font-weight: 400;
          color: #3a3a50;
          letter-spacing: 0;
        }

        .input-row {
          position: relative;
        }

        .channel-input {
          width: 100%;
          background: #0d0d16;
          border: 1px solid #1e1e2e;
          border-radius: 12px;
          padding: 0.85rem 1rem;
          font-size: 15px;
          color: #e2e2f0;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
          font-family: inherit;
        }

        .channel-input::placeholder {
          color: #3a3a50;
        }

        .channel-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px #6366f120;
        }

        /* ─── Avatar Picker ─── */
        .avatar-picker {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 10px 0;
        }

        .avatar-preview {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
          transition: background 0.2s;
          border: 2px solid rgba(255,255,255,0.1);
          box-shadow: 0 0 16px rgba(99,102,241,0.15);
        }

        .color-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .color-swatch {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 2px solid transparent;
          cursor: pointer;
          transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
          padding: 0;
        }

        .color-swatch:hover {
          transform: scale(1.15);
        }

        .color-swatch--active {
          border-color: #fff;
          box-shadow: 0 0 0 3px rgba(255,255,255,0.15);
          transform: scale(1.1);
        }

        .error-msg {
          font-size: 13px;
          color: #f87171;
          margin: 4px 0 0;
        }

        .join-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 8px;
          background: #6366f1;
          color: #fff;
          border: none;
          border-radius: 12px;
          padding: 0.9rem 1.5rem;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, transform 0.1s;
        }

        .join-btn:hover {
          background: #5254cc;
        }

        .join-btn:active {
          transform: scale(0.98);
        }

        .hint {
          margin-top: 1.5rem;
          font-size: 12px;
          color: #3a3a50;
          text-align: center;
          line-height: 1.5;
        }
      `}</style>
    </main>
  );
}
