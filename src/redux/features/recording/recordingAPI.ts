import baseAPI from "@/redux/api/api";

const recordingAPI = baseAPI.injectEndpoints({
  endpoints: (build) => ({
    saveRecording: build.mutation({
      query: (body) => ({
        url: "/recordings/save/",
        method: "POST",
        body,
      }),

    }),
  }),
});

export const { useSaveRecordingMutation } = recordingAPI;
export default recordingAPI;
