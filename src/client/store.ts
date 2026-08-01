"use client";

import { roomHttpBase } from "./roomUrl";
import { emptyWardrobe, type Wardrobe } from "../store/types";

/**
 * Talking to the server about what you own.
 *
 * Every answer here comes from the server. The catalogue is local data (it is
 * the same for everyone), but ownership is not — a wardrobe read from
 * localStorage is a wardrobe anyone can edit in a console, which would make
 * every purchase feel like a joke.
 */

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${roomHttpBase()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export async function fetchWardrobe(token: string): Promise<{ wardrobe: Wardrobe; guest: boolean }> {
  try {
    const result = await post<{ wardrobe: Wardrobe; guest: boolean }>("/auth/wardrobe", {}, token);
    return { wardrobe: result.wardrobe ?? emptyWardrobe(), guest: !!result.guest };
  } catch {
    // The store is not worth breaking a page over; an empty wardrobe still
    // shows the free items and everything the catalogue offers.
    return { wardrobe: emptyWardrobe(), guest: true };
  }
}

export async function equipItem(itemId: string, token: string): Promise<Wardrobe> {
  const result = await post<{ wardrobe: Wardrobe }>("/auth/equip", { itemId }, token);
  return result.wardrobe;
}
