import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getTokenPayload } from 'pocketbase';
import pb from '@/api/pocketbase';
import type { User } from '@/api/pocketbase';
import { clearLocalStoragePrefix, clearSessionCachePrefix, readSessionCache, removeSessionCache, writeSessionCache } from '@/utils/session-cache';
import { isValidUsername, normalizeUsername } from '@/utils/username';

const STORES_CACHE_KEY = 'billiard:stores:v1';

interface AuthContextType {
  user: User | null;
  storeId: string | null;
  storeName: string | null;
  storeNameStatus: 'loading' | 'ready' | 'error';
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  loginWithPassword: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, fullname: string, phone: string, store: string, referralCode?: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getLocalizedAuthError(err: any, action: 'login' | 'register'): string {
  const response = err?.response;
  const status = err?.status ?? response?.status;
  const data = response?.data ?? {};
  const localMessages = [
    'Tên đăng nhập không hợp lệ.',
    'Vui lòng nhập tên đăng nhập.',
    'Vui lòng nhập mật khẩu.',
    'Mật khẩu cần có ít nhất 8 ký tự.',
    'Vui lòng nhập họ và tên.',
    'Vui lòng chọn cửa hàng.',
    'Vui lòng nhập số điện thoại.',
    'Số điện thoại phải gồm 10 chữ số di động Việt Nam.',
  ];

  if (err instanceof Error && localMessages.includes(err.message)) return err.message;

  if (status === 0 || err instanceof TypeError) {
    return 'Không kết nối được máy chủ. Vui lòng kiểm tra PocketBase đang chạy rồi thử lại.';
  }

  if (action === 'login') {
    if (status === 403) return 'Tài khoản đang chờ cửa hàng phê duyệt. Vui lòng thử lại sau khi được duyệt.';
    if (status === 400 || status === 401) return 'Tên đăng nhập hoặc mật khẩu không đúng.';
    return 'Không thể đăng nhập lúc này. Vui lòng thử lại.';
  }

  const usernameError = data.username;
  if (usernameError) {
    const detail = `${usernameError.code ?? ''} ${usernameError.message ?? ''}`.toLowerCase();
    return detail.includes('unique')
      ? 'Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.'
      : 'Tên đăng nhập chỉ được gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.';
  }
  const serverMessage = String(response?.message ?? err?.message ?? '');
  if (action === 'register' && serverMessage.includes('Mã giới thiệu')) return serverMessage;
  if (data.phone) return 'Số điện thoại không hợp lệ hoặc đã được sử dụng.';
  if (data.password || data.passwordConfirm) return 'Mật khẩu cần có ít nhất 8 ký tự và nhập xác nhận chính xác.';
  if (data.store) return 'Vui lòng chọn cửa hàng hợp lệ.';
  if (status === 400) return 'Thông tin đăng ký chưa hợp lệ. Vui lòng kiểm tra lại các trường.';
  return 'Không thể đăng ký lúc này. Vui lòng thử lại.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [storeNameStatus, setStoreNameStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const storeId = user?.store || null;

  useEffect(() => {
    let active = true;
    setStoreName(null);

    if (!storeId) {
      setStoreNameStatus('ready');
      return () => { active = false; };
    }

    setStoreNameStatus('loading');

    const cachedStores = readSessionCache<{ id: string; name: string }[]>(STORES_CACHE_KEY, 60 * 60 * 1000);
    if (cachedStores) {
      setStoreName(cachedStores.find((store) => store.id === storeId)?.name ?? null);
      setStoreNameStatus('ready');
    }

    pb.send<{ id: string; name: string }[]>('/api/registration/stores', { method: 'GET' })
      .then((stores) => {
        if (!active) return;
        writeSessionCache(STORES_CACHE_KEY, stores);
        setStoreName(stores.find((store) => store.id === storeId)?.name ?? null);
        setStoreNameStatus('ready');
      })
      .catch((err) => {
        if (!active) return;
        console.warn('Failed to load store name:', err);
        if (!cachedStores) setStoreNameStatus('error');
      });

    return () => { active = false; };
  }, [storeId]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const model = pb.authStore.model as User | null;

        if (model && pb.authStore.isValid) {
          setUser(model);
          void pb.collection('users').authRefresh().catch((err) => {
            console.warn('Failed to refresh authenticated user:', err);
          });
        } else {
          pb.authStore.clear();
          setUser(null);
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        pb.authStore.clear();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    return pb.authStore.onChange((token, model) => {
      setUser(model as User | null);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const token = pb.authStore.token;
    const expiresAt = getTokenPayload(token).exp;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return;

    let timeout: number;
    const checkExpiry = () => {
      if (pb.authStore.token !== token) return;
      const remaining = expiresAt * 1000 - Date.now();
      if (remaining <= 0) return pb.authStore.clear();
      timeout = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
    };
    timeout = window.setTimeout(checkExpiry, Math.min(Math.max(0, expiresAt * 1000 - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [user]);

  const loginWithPassword = async (username: string, password: string) => {
    try {
      setError(null);
      setIsLoading(true);

      const normalizedUsername = normalizeUsername(username);
      if (!normalizedUsername) throw new Error('Vui lòng nhập tên đăng nhập.');
      if (!isValidUsername(normalizedUsername)) throw new Error('Tên đăng nhập không hợp lệ.');
      if (!password) throw new Error('Vui lòng nhập mật khẩu.');
      const authData = await pb.collection('users').authWithPassword(normalizedUsername, password);
      setUser(authData.record as unknown as User);
      try {
        await pb.send('/api/xu/referral', { method: 'GET' });
      } catch (referralError) {
        console.warn('Referral reward processing deferred:', referralError);
      }
    } catch (err) {
      setError(getLocalizedAuthError(err, 'login'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (username: string, password: string, fullname: string, phone: string, store: string, referralCode = '') => {
    try {
      setError(null);
      setIsLoading(true);

      const normalizedUsername = normalizeUsername(username);
      if (!normalizedUsername) throw new Error('Vui lòng nhập tên đăng nhập.');
      if (!isValidUsername(normalizedUsername)) throw new Error('Tên đăng nhập không hợp lệ.');
      if (!password) throw new Error('Vui lòng nhập mật khẩu.');
      if (password.length < 8) throw new Error('Mật khẩu cần có ít nhất 8 ký tự.');
      if (!fullname.trim()) throw new Error('Vui lòng nhập họ và tên.');
      if (!store) throw new Error('Vui lòng chọn cửa hàng.');
      if (!phone) throw new Error('Vui lòng nhập số điện thoại.');
      if (!/^0[35789][0-9]{8}$/.test(phone)) throw new Error('Số điện thoại phải gồm 10 chữ số di động Việt Nam.');

      const user = await pb.send<User>('/api/registration/register', { method: 'POST', body: {
        username: normalizedUsername,
        password,
        passwordConfirm: password,
        fullname: fullname.trim(),
        phone,
        store,
        referralCode: referralCode.trim().toUpperCase(),
      } });

      return user.is_approved === true;
    } catch (err) {
      const localMessage = err instanceof Error && (err.message === 'Tên đăng nhập không hợp lệ.' || err.message === 'Số điện thoại phải gồm 10 chữ số di động Việt Nam.')
        ? err.message
        : null;
      setError(localMessage ?? getLocalizedAuthError(err, 'register'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    pb.authStore.clear();
    clearSessionCachePrefix('billiard:payment-settings:');
    clearLocalStoragePrefix('billiard:payment-settings:');
    removeSessionCache('wallet-topup-resume');
    setUser(null);
    setError(null);
  };

  const clearError = () => {
    setError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        storeId,
        storeName,
        storeNameStatus,
        isAuthenticated: pb.authStore.isValid && user !== null,
        isLoading,
        error,
        loginWithPassword,
        register,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
