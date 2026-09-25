import { Outlet } from "react-router-dom";
import { useStaffContext } from "../moderation/staffContext";
export function RequireImportAdmin() {
  const context = useStaffContext();
  return context.role === "admin" ? <Outlet context={context} /> : (
    <section>
      <h1>Admin access required</h1>
      <p>CSV event imports require an active admin role.</p>
    </section>
  );
}
