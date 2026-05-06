/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
  BaseQueryFn,
  createApi,
  FetchArgs,
  fetchBaseQuery,
  FetchBaseQueryError,
} from "@reduxjs/toolkit/query/react";
import { toast } from "sonner";

const baseQuery = fetchBaseQuery({
  baseUrl: process.env.NEXT_PUBLIC_API_URL,
  credentials: "include",
  prepareHeaders: (headers) => {
    console.log("Preparing headers for API request", window?.location?.href);

    if (typeof window !== "undefined") {
      const token = localStorage?.getItem("access_token");
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
    }
    return headers;
  },
});

let isLoggingOut = false;

const customBaseQuery: BaseQueryFn<
  FetchArgs | string,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const result = await baseQuery(args, api, extraOptions);

  if (typeof window === "undefined") {
    return result;
  }

  const pathname = window?.location?.pathname || "";

  if (result.error) {
    const status = result.error.status;

    if (status === 401) {
      if (!isLoggingOut && pathname !== "/login") {
        isLoggingOut = true;
        localStorage?.removeItem("access_token");
        toast.error("Session expired. Please login again.");

        setTimeout(() => {
          isLoggingOut = false;
          window.location.replace("/login");
        }, 400);
      }
    } else if (status === 403) {
      toast.error("You need to verify your email to use this feature.");
      window.location.href = "/profile";
    } else if (status === 402) {
      toast.error("You need to upgrade your plan to use this feature.");
      window.location.href = "/#upgrade-plan";
    }

    return result;
  }

  const data = result.data as any;

  if (data && data.status === false) {
    const appStatus = data.status_code as number;

    if (appStatus === 401) {
      if (!isLoggingOut && pathname !== "/login") {
        isLoggingOut = true;
        localStorage?.removeItem("access_token");
        toast.error(data.message || "Session expired. Please login again.");

        setTimeout(() => {
          isLoggingOut = false;
          window.location.replace("/login");
        }, 400);
      }
    } else if (appStatus === 403) {
      toast.error(
        data.message || "You need to verify your email to use this feature.",
      );
      window.location.href = "/profile";
    } else if (appStatus === 402) {
      toast.error(
        data.message || "You need to upgrade your plan to use this feature.",
      );
      window.location.href = "/#upgrade-plan";
    } else {
      toast.error(data.message || "Something went wrong.");
    }

    return {
      error: {
        status: appStatus,
        data: data,
      } as FetchBaseQueryError,
    };
  }

  return result;
};

export const baseAPI = createApi({
  reducerPath: "api",
  baseQuery: customBaseQuery,
  tagTypes: ["Post", "Settings", "Profile", "Users", "Jobs"],
  endpoints: () => ({}),
});

export default baseAPI;

export type TList = {
  page?: number;
  limit?: number;
  search?: string;
};
