/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useGetUserProfileQuery } from "@/redux/features/user/userAPI";
import { setProfileLoading, setUser } from "@/redux/features/auth/authSlice";

export default function AppInitializer({
  children,
}: {
  children: React.ReactNode;
}) {
  const dispatch = useDispatch();

  // We use a local state to trigger a re-render once the token is found in the URL
  const [activeToken, setActiveToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const tokenFromUrl = searchParams.get("token");
      const jobIdFromUrl = searchParams.get("jobId");
      const tokenFromStorage = localStorage.getItem("access_token");

      if (tokenFromUrl) {
        // 1. Save to localStorage
        localStorage.setItem("access_token", tokenFromUrl);
        localStorage.setItem("jobId", jobIdFromUrl || "");
        setActiveToken(tokenFromUrl);

        // 2. Clean the URL (removes ?token=... without refreshing the page)
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
      } else if (tokenFromStorage) {
        setActiveToken(tokenFromStorage);
      } else {
        dispatch(setProfileLoading(false));
      }
    }
  }, [dispatch]);

  // The query will now auto-run as soon as activeToken is set
  const { data, isLoading } = useGetUserProfileQuery(
    {},
    { skip: !activeToken },
  );

  console.log({ data, activeToken });

  useEffect(() => {
    dispatch(setProfileLoading(isLoading));
  }, [isLoading, dispatch]);

  useEffect(() => {
    if (data?.data) {
      dispatch(
        setUser({
          user: data.data,
          token: data.access_token || activeToken,
        }),
      );
    }
  }, [data, activeToken, dispatch]);

  return children;
}
