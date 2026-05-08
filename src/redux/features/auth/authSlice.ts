/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSlice } from "@reduxjs/toolkit";

type TUser = {
  user_id: number;
  full_name: string;
  email: string;
  phone: string;
  profile_pic: string;
  role: string;
  bio: string | null;
  agency_name: string | null;
  company: string;
  website: string;
  is_active: boolean;
  date_joined: string;
};

type TAuthState = {
  userToggle: boolean;
  user: TUser | null;
  token: string | null;
  profileLoading?: boolean;
};

const initialState: TAuthState = {
  userToggle: false,
  user: null,
  token: null,
  profileLoading: true,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    userTrack: (state) => {
      state.userToggle = !state.userToggle;
    },

    setUser: (state, action) => {
      const { user, token } = action.payload;
      state.user = user;
      state.token = token;
    },

    logout: (state) => {
      state.user = null;
      state.token = null;
    },

    setProfileLoading: (state, action) => {
      state.profileLoading = action.payload;
    },
  },
});

export const { userTrack, setUser, logout, setProfileLoading } =
  authSlice.actions;
export default authSlice.reducer;
