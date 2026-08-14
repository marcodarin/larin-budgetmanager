import { NavLink } from 'react-router-dom';
import { LogOut, FileText, FileSignature, FolderKanban, CheckCircle2, Calendar, HelpCircle, Eye, EyeOff, UserCog, BookOpen, GitBranch, Plug, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { NotificationBell } from '@/components/NotificationBell';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRoleSimulation } from '@/contexts/RoleSimulationContext';
import { getRolePermissions } from '@/lib/permissions';
import { useUnreadChangelog } from '@/hooks/useUnreadChangelog';
import logo from '@/assets/logo-tt.svg';

type UserRole = 'admin' | 'account' | 'finance' | 'team_leader' | 'coordinator' | 'member' | 'external';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  account: 'Account',
  finance: 'Finance',
  team_leader: 'Team Leader',
  coordinator: 'Coordinator',
  member: 'Member',
  external: 'External',
};

const AVAILABLE_ROLES: UserRole[] = ['admin', 'account', 'finance', 'team_leader', 'coordinator', 'member', 'external'];

interface AppHeaderProps {
  onLogout: () => void;
  userProfile: { first_name: string; last_name: string; avatar_url?: string } | null;
  userRole: 'admin' | 'account' | 'finance' | 'team_leader' | 'coordinator' | 'member' | 'external' | null;
  onStartTour?: () => void;
}

export const AppHeader = ({ onLogout, userProfile, userRole, onStartTour }: AppHeaderProps) => {
  const { getEffectiveRole, simulatedRole, isSimulating, startSimulation, stopSimulation } = useRoleSimulation();
  const effectiveRole = getEffectiveRole(userRole);
  const isRealAdmin = userRole === 'admin';
  const { data: unreadChangelog } = useUnreadChangelog();
  const unreadCount = unreadChangelog?.count ?? 0;
  
  const permissions = getRolePermissions(effectiveRole);
  const isAdmin = effectiveRole === 'admin' || effectiveRole === 'account';
  const canViewProjects = effectiveRole !== null;
  
  // Debug log - remove after fixing
  console.log('[AppHeader] Debug permissions:', { userRole, effectiveRole, canEditBudget: permissions.canEditBudget, permissions });
  
  const getInitials = () => {
    if (!userProfile) return 'U';
    const firstInitial = userProfile.first_name?.charAt(0) || '';
    const lastInitial = userProfile.last_name?.charAt(0) || '';
    return (firstInitial + lastInitial).toUpperCase() || 'U';
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background border-b">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        {/* Left: Logo and App Name - Clickable to Home */}
        <div className="flex items-center gap-6">
          <NavLink to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src={logo} alt="Logo" className="h-8 w-8" />
            <div className="flex flex-col">
              <span className="text-lg font-semibold text-foreground leading-tight">TimeTrap</span>
              <span className="text-xs text-muted-foreground">Make smartworking smarter</span>
            </div>
          </NavLink>
          
          {/* Navigation Links */}
          <nav className="flex items-center gap-4">
            <NavLink 
              to="/calendar" 
              className={({ isActive }) => 
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive 
                    ? 'bg-primary text-primary-foreground' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`
              }
            >
              <Calendar className="h-4 w-4" />
              Calendario
            </NavLink>
            {permissions.canEditBudget && (
              <NavLink 
                to="/budgets" 
                className={({ isActive }) => 
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                <FolderKanban className="h-4 w-4" />
                Budget
              </NavLink>
            )}
            {(isAdmin || effectiveRole === 'team_leader') && (
              <NavLink 
                to="/quotes" 
                className={({ isActive }) => 
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                <FileText className="h-4 w-4" />
                Preventivi
              </NavLink>
            )}
            {(isAdmin || effectiveRole === 'team_leader') && (
              <NavLink
                to="/offers"
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                <FileSignature className="h-4 w-4" />
                Offerte
              </NavLink>
            )}
            {(isAdmin || effectiveRole === 'finance') && (
              <NavLink
                to="/invoices"
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                <Receipt className="h-4 w-4" />
                Fatture
              </NavLink>
            )}
            {canViewProjects && effectiveRole !== 'external' && (
              <NavLink 
                to="/approved-projects" 
                className={({ isActive }) => 
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                Progetti
              </NavLink>
            )}
            {effectiveRole === 'external' && (
              <NavLink 
                to="/approved-projects" 
                className={({ isActive }) => 
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                Progetti
              </NavLink>
            )}
            {effectiveRole !== 'external' && (
              <NavLink 
                to="/workflows" 
                className={({ isActive }) => 
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                <GitBranch className="h-4 w-4" />
                Flussi
              </NavLink>
            )}
          </nav>
        </div>

        {/* Right: User Profile & Logout */}
        <div className="flex items-center gap-2">
          {/* Simulation Badge */}
          {isSimulating && (
            <Badge 
              variant="outline" 
              className="bg-warning/10 text-warning border-warning/30 animate-pulse"
            >
              <Eye className="h-3 w-3 mr-1" />
              {ROLE_LABELS[simulatedRole as UserRole]}
            </Badge>
          )}
          
          <ThemeToggle />
          <div data-tour="notifications">
            <NotificationBell />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative flex items-center gap-2" data-tour="profile-menu">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={userProfile?.avatar_url} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {getInitials()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">
                  {userProfile?.first_name} {userProfile?.last_name}
                </span>
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1 left-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background"
                    aria-label={`${unreadCount} novità non lette`}
                  />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild>
                <NavLink to="/profile" className="cursor-pointer">
                  Profilo
                </NavLink>
              </DropdownMenuItem>
              
              {/* Role Simulation - Only for real admins */}
              {isRealAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="cursor-pointer">
                      <UserCog className="h-4 w-4 mr-2" />
                      Simula ruolo
                      {isSimulating && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          Attivo
                        </Badge>
                      )}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      <DropdownMenuLabel>Visualizza come</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {AVAILABLE_ROLES.map((role) => (
                        <DropdownMenuItem
                          key={role}
                          onClick={() => startSimulation(role)}
                          className={`cursor-pointer ${simulatedRole === role ? 'bg-accent' : ''}`}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          {ROLE_LABELS[role]}
                          {simulatedRole === role && (
                            <span className="ml-auto text-xs text-muted-foreground">✓</span>
                          )}
                        </DropdownMenuItem>
                      ))}
                      {isSimulating && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={stopSimulation}
                            className="cursor-pointer text-destructive focus:text-destructive"
                          >
                            <EyeOff className="h-4 w-4 mr-2" />
                            Termina simulazione
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
              
              {onStartTour && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onStartTour} className="cursor-pointer">
                    <HelpCircle className="h-4 w-4 mr-2" />
                    Guida interattiva
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <NavLink to="/connect" className="cursor-pointer">
                  <Plug className="h-4 w-4 mr-2" />
                  Collega assistente AI
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to="/help" className="cursor-pointer">
                  <BookOpen className="h-4 w-4 mr-2" />
                  <span className="flex-1">Guida e Aiuto</span>
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1.5 text-xs">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Badge>
                  )}
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogout} className="cursor-pointer">
                <LogOut className="h-4 w-4 mr-2" />
                Esci
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};
