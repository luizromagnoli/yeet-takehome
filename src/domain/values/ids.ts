/**
 * Branded ID types. They are plain strings at runtime — the brand exists only
 * at the type level to prevent passing, say, a user_id where an action_id is
 * expected. Validation of the underlying string format happens upstream at
 * the DTO layer (class-validator `@IsUUID()`).
 */

declare const userIdBrand: unique symbol;
declare const actionIdBrand: unique symbol;
declare const txIdBrand: unique symbol;
declare const gameIdBrand: unique symbol;

export type UserId = string & { readonly [userIdBrand]: true };
export type ActionId = string & { readonly [actionIdBrand]: true };
export type TxId = string & { readonly [txIdBrand]: true };
export type GameId = string & { readonly [gameIdBrand]: true };

export const asUserId = (s: string): UserId => s as UserId;
export const asActionId = (s: string): ActionId => s as ActionId;
export const asTxId = (s: string): TxId => s as TxId;
export const asGameId = (s: string): GameId => s as GameId;
