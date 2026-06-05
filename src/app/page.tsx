/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import Image from "next/image";
import { useDispatch } from "react-redux";
import {
  setProfileLoading,
  setUser,
  userTrack,
} from "@/redux/features/auth/authSlice";

export default function Home() {
  const dispatch = useDispatch();
  const router = useRouter();
  const [channelName, setChannelName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { user, profileLoading } = useAuth();

  useEffect(() => {
    const jobId = localStorage.getItem("jobId");
    if (jobId) {
      setChannelName(jobId);
    }
  }, []);

  const baseURL = process.env.NEXT_PUBLIC_IMAGE_URL;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!user) {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/accounts/login/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );

      const data = await res.json();

      if (res?.ok) {
        dispatch(userTrack());
        dispatch(
          setUser({
            user: data?.user,
            token: data?.access_token,
          }),
        );
        dispatch(setProfileLoading(false));

        // await saveTokens(data?.access_token);
        localStorage.setItem("access_token", data?.access_token);

        setError("Please login to join a channel.");
        return;
      }
    }

    // const trimmedChannel = channelName.trim();

    const trimmedChannel = channelName.replace(/[\s]/g, "");
    if (!trimmedChannel) {
      setError("Please enter a channel name.");
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedChannel)) {
      setError("Only letters, numbers, hyphens, and underscores are allowed.");
      return;
    }

    router.push(`/channel/${encodeURIComponent(trimmedChannel)}`);
  }

  return (
    <main className='join-page'>
      <div className='join-card'>
        <div className='logo-row'>
          <span className='logo-dot' />
          <span className='brand'>LiveRoom</span>
        </div>

        <h1 className='headline'>
          Start or join a <span className='headline-accent'>video call</span>
        </h1>

        <p className='subline'>
          Set your name, pick an avatar, and enter a channel to get started.
        </p>

        <form onSubmit={handleSubmit} className='join-form'>
          {/* ─── Display Name ─── */}
          {user && !profileLoading ? (
            <div>
              <h2 className='field-label text-xl! text-center! mb-2!'>
                <span className='text-[#ffffff]!'>{user?.full_name}</span>
              </h2>
              <div className='flex items-center justify-center'>
                <Image
                  src={
                    ((baseURL! + user?.profile_pic) as string) ||
                    "/placeholder.png"
                  }
                  width={100}
                  height={100}
                  unoptimized
                  alt={user?.full_name as string | "photo"}
                  className='w-20 h-20 rounded-full'
                />
              </div>
            </div>
          ) : profileLoading ? (
            <div>
              <h2 className='field-label text-xl! text-center! mb-2!'>
                <span className='text-[#ffffff]!'>Loading...</span>
              </h2>
            </div>
          ) : (
            <div>
              <h2 className='text-center!'>
                Login - First Time{" "}
                <span className='text-[#6366f1]!'>(No repeated)</span>
              </h2>

              <div className='input-row space-y-2.5!'>
                <label className='field-label' style={{ marginTop: "12px" }}>
                  Email
                </label>
                <input
                  id='email'
                  type='email'
                  placeholder='example@mail.com'
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                  }}
                  className='channel-input mt-1!'
                  autoComplete='name'
                  spellCheck={false}
                  maxLength={30}
                />
              </div>

              <div className='input-row space-y-2.5! mt-4!'>
                <label className='field-label ' style={{ marginTop: "20px" }}>
                  Password
                </label>
                <input
                  id='password'
                  type='password'
                  placeholder='******'
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  className='channel-input mt-1!'
                  autoComplete='password'
                  spellCheck={false}
                  maxLength={30}
                />
              </div>
            </div>
          )}

          {/* ─── Channel Name ─── */}
          {/* <label
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
          </div> */}

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
