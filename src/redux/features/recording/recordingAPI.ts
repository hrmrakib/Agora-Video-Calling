import baseAPI from "@/redux/api/api";

const recordingAPI = baseAPI.injectEndpoints({
  endpoints: (build) => ({
    saveRecording: build.mutation({
      query: (body) => ({
        url: `/jobs/jobs/${body.jobId}/meetings/`,
        method: "POST",
        body,
      }),
    }),
  }),
});

export const { useSaveRecordingMutation } = recordingAPI;
export default recordingAPI;
