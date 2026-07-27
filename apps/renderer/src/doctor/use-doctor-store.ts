import { useStore } from "zustand";
import { doctorStore, type DoctorState } from "./doctor-store.js";

export function useDoctorStore<T>(selector: (state: DoctorState) => T): T {
  return useStore(doctorStore, selector);
}
