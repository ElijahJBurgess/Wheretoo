import { useQuery } from "@tanstack/react-query";
import { listImports, readImport } from "./eventImports.api";
export function useImports(actor: string) {
  return useQuery({
    queryKey: ["event-imports", actor, "list"],
    queryFn: listImports,
    enabled: Boolean(actor),
  });
}
export function useImport(actor: string, batchId: string, offset: number) {
  return useQuery({
    queryKey: ["event-imports", actor, batchId, offset],
    queryFn: () => readImport(batchId, offset),
    enabled: Boolean(actor && batchId),
  });
}
