import { fireEvent } from "@testing-library/react";

/** Exercise the same explicit commit path as a user; no synthetic native change event. */
export function selectValue(trigger: HTMLElement, value: string) {
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  const popup = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  const option = [...popup?.querySelectorAll<HTMLElement>('[role="option"]') ?? []].find(item => item.dataset.optionValue === value);
  if (!option) throw new Error(`Selection option was not available: ${value}`);
  fireEvent.click(option);
}
