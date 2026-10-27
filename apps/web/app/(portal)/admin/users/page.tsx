import { redirect } from "next/navigation";

export default function AdminUsersRedirect() {
  redirect("/settings/users-and-access");
}
