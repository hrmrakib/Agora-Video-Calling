"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { useGetUserProfileQuery } from "@/redux/features/user/userAPI";
import { setProfileLoading, setUser } from "@/redux/features/auth/authSlice";

export default function AppInitializer({
  children,
}: {
  children: React.ReactNode;
}) {
  const dispatch = useDispatch();
  const token =
    typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  const { data, isLoading } = useGetUserProfileQuery({}, { skip: !token });

  useEffect(() => {
    if (!token) {
      dispatch(setProfileLoading(false));
      return;
    }

    dispatch(setProfileLoading(isLoading));
  }, [isLoading, token, dispatch]);

  useEffect(() => {
    if (data?.data) {
      dispatch(setUser({ user: data.data, token: data.access_token || token }));
    }
  }, [data, token, dispatch]);

  return children;
}
