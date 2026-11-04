"use client";
import { useEffect, useRef } from "react";
import { RequestScope } from "./request-scope";
export function useRequestScope() {
  const scope = useRef<RequestScope | null>(null);
  if (!scope.current) scope.current = new RequestScope();
  const current = scope.current;
  useEffect(() => () => current.cancel(), [current]);
  return current;
}
