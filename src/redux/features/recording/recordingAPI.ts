import baseAPI from "@/redux/api/api";

const recordingAPI = baseAPI.injectEndpoints({
  endpoints: (build) => ({
    saveRecording: build.mutation({
      query: ({ jobId, body }) => ({
        url: `/jobs/jobs/${jobId}/meetings/`,
        method: "POST",
        body,
      }),
    }),
  }),
});

export const { useSaveRecordingMutation } = recordingAPI;
export default recordingAPI;
