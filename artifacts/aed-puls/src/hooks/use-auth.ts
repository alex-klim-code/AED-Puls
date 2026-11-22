import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSessionQueryKey,
  useDemoLogin,
  useGetSession,
  useLogout,
} from '@workspace/api-client-react';

export function useSession() {
  const q = useGetSession();
  return { ...q, session: q.data, user: q.data?.user };
}

/** Logowanie i wylogowanie z czyszczeniem pamięci podręcznej zależnej od tożsamości. */
export function useAuthActions() {
  const qc = useQueryClient();
  const sessionKey = getGetSessionQueryKey()[0];
  const clearScoped = () =>
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionKey });

  const demoLogin = useDemoLogin({
    mutation: {
      onSuccess: (session) => {
        clearScoped();
        qc.setQueryData(getGetSessionQueryKey(), session);
      },
    },
  });
  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        clearScoped();
        qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      },
    },
  });
  return { demoLogin, mockLogin: demoLogin, logout };
}

export function errorText(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message;
  return 'Nieznany błąd serwera.';
}
