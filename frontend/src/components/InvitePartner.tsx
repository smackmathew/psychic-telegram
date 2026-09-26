import { useQuery } from "@tanstack/react-query";
import { HouseholdApi } from "../api/endpoints";

/** Shows the household's invite code while nobody else has joined yet. */
export default function InvitePartner() {
  const { data: members } = useQuery({ queryKey: ["household-members"], queryFn: HouseholdApi.members });
  const { data: household } = useQuery({ queryKey: ["household"], queryFn: HouseholdApi.get, enabled: members?.length === 1 });

  if (members?.length !== 1 || !household) return null;

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-slate-700">
      <p className="font-semibold text-slate-800">Invite your partner</p>
      <p className="mt-1">
        Have them choose "Sign up" and enter the invite code{" "}
        <span className="rounded bg-white px-2 py-0.5 font-mono font-semibold tracking-widest text-brand-700">{household.invite_code}</span>{" "}
        to share this household's data with you.
      </p>
    </div>
  );
}
