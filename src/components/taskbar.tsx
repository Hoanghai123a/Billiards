import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "zmp-ui";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffQueue } from "@/contexts/StaffQueueContext";
import {
  RiDashboardFill,
  RiDashboardLine,
  RiLayoutGridFill,
  RiLayoutGridLine,
  RiNewspaperFill,
  RiNewspaperLine,
  RiListCheck2,
  RiListCheck,
} from "react-icons/ri";

interface TabItem {
  path: string;
  label: string;
  icon: any;
  activeIcon?: any;
}

const TABS: TabItem[] = [
  {
    path: "/news",
    label: "Bảng tin",
    icon: <RiNewspaperLine size={28} />,
    activeIcon: <RiNewspaperFill size={28} />,
  },
  {
    path: "/home",
    label: "Đặt bàn",
    icon: <RiLayoutGridLine size={28} />,
    activeIcon: <RiLayoutGridFill size={28} />,
  },
  {
    path: "/account",
    label: "Tài khoản",
    icon: (
      <Icon
        className="flex items-center justify-center"
        icon="zi-user"
        size={28}
      />
    ),
    activeIcon: (
      <Icon
        className="flex items-center justify-center"
        icon="zi-user-solid"
        size={28}
      />
    ),
  },
];

const PILL_REST_WIDTH = 60;
const PILL_STRETCH_WIDTH = 120;

const TabBar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { historyUnread } = useStaffQueue();
  const queueTab = {
    path: "/staff/queue",
    label: "Hàng chờ",
    icon: <RiListCheck size={28} />,
    activeIcon: <RiListCheck2 size={28} />,
  };
  const tabs = useMemo(() => user?.role === "admin"
    ? [...TABS.slice(0, 2), queueTab, {
      path: "/admin",
      label: "Quản trị",
      icon: <RiDashboardLine size={28} />,
      activeIcon: <RiDashboardFill size={28} />,
    }, TABS[2]]
    : user?.role === "staff" ? [...TABS.slice(0, 2), queueTab, TABS[2]]
    : TABS, [user?.role]);

  const activeIndex = useMemo(() => {
    const index = tabs.findIndex((tab) => tab.path === location.pathname || (tab.path === "/admin" && location.pathname.startsWith("/admin/")));
    return index === -1 ? 0 : index;
  }, [location.pathname, tabs]);

  const [isStretching, setIsStretching] = useState(false);

  useEffect(() => {
    setIsStretching(true);
    const timer = setTimeout(() => setIsStretching(false), 220);
    return () => clearTimeout(timer);
  }, [activeIndex]);

  const handleNavigate = (path: string, index: number) => {
    if (index === activeIndex) return;
    navigate(path);
  };

  if (location.pathname === "/cart" || location.pathname === "/login") return null;

  const slotWidth = 100 / tabs.length;
  const pillWidth = isStretching ? PILL_STRETCH_WIDTH : PILL_REST_WIDTH;

  return (
    <nav
      className="fixed inset-x-4 z-40"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}
    >
      <div
        className="h2-glass-surface mx-auto max-w-sm rounded-full border border-green-100/50
        py-1.5 shadow-[0_8px_32px_-8px_rgba(26,182,135,0.25)] backdrop-blur-xl
        dark:border-green-500/20 dark:bg-slate-900/70"
      >
        <div className="relative flex items-center">
          <div
            className={`absolute left-0 top-1/2 h-[60px] rounded-full
            transition-all duration-300 ease-in-out bg-gradient-to-b from-orange-400 to-orange-600 
            shadow-[0_4px_12px_-2px_rgba(26,182,135,0.5)]`}
            style={{
              width: `${pillWidth}px`,
              left: `calc(${activeIndex * slotWidth}% + (${slotWidth}% - ${pillWidth}px) / 2)`,
              transform: "translateY(-50%)",
              opacity: isStretching ? 0.3 : 1,
            }}
          />
          {tabs.map((tab, index) => {
            const active = index === activeIndex;
            const unread = tab.path === "/staff/queue" && historyUnread;
            return (
              <button
                key={tab.path}
                type="button"
                aria-label={unread ? `${tab.label}, lịch sử có cập nhật mới` : tab.label}
                aria-current={active ? "page" : undefined}
                title={tab.label}
                onClick={() => handleNavigate(tab.path, index)}
                className="relative z-10 flex h-[60px] flex-1 flex-col items-center justify-center border-0 bg-transparent py-1"
              >
                <div
                  className={`${
                    active
                      ? "text-white dark:text-white"
                      : "text-slate-500 dark:text-slate-400"
                  } relative flex items-center justify-center transition-all w-10 h-10 duration-300`}
                >
                  {active && tab.activeIcon ? tab.activeIcon : tab.icon}
                  {unread && <span aria-hidden="true" className="absolute right-0 top-0 h-2 w-2 rounded-full bg-rose-600 ring-2 ring-white" />}
                </div>
                {tab.path === "/staff/queue" && <span className={`text-[10px] font-semibold leading-none ${active ? "text-white" : "text-slate-500"}`}>Hàng chờ</span>}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default TabBar;
