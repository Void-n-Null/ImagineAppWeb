import { useQuery } from '@tanstack/react-query'
import { type GetBalanceResult, getBalance } from '#/server/functions/balance'

/**
 * The signed-in user's credit balance (IMA-32, IMA-16 #366). One indexed
 * query behind getBalance; refetch on focus so a top-up (or a spend from
 * another tab / a chat turn) shows up when the user returns to Settings.
 * Short staleTime keeps it live without hammering — the balance changes as
 * the user chats.
 */
export function useBalance() {
  return useQuery<GetBalanceResult>({
    queryKey: ['balance'],
    queryFn: () => getBalance(),
    staleTime: 15 * 1000,
    retry: 1,
  })
}
