import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";

export function useAuth() {
  const user = useSelector((state: RootState) => state.auth.user);
  const token = useSelector((state: RootState) => state.auth.token);
  const profileLoading = useSelector(
    (state: RootState) => state.auth.profileLoading,
  );

  return {
    user,
    token,
    profileLoading,
    isLoggedIn: !!user,
  };
}
