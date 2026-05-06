import baseAPI from "@/redux/api/api";

const userAPI = baseAPI.injectEndpoints({
  endpoints: (build) => ({
    getUserProfile: build.query({
      query: () => ({
        url: "/accounts/user/profile/",
      }),
      providesTags: ["Profile"],
    }),

    updateProfile: build.mutation({
      query: (data) => ({
        url: "/accounts/user/profile/",
        method: "PATCH",
        body: data,
      }),
      invalidatesTags: ["Profile"],
    }),
  }),
});

export const { useGetUserProfileQuery, useUpdateProfileMutation } = userAPI;
export default userAPI;
