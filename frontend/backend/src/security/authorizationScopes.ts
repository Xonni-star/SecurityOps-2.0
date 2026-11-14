export const SITE_SCOPED_PERMISSION_CODES = new Set([
  'customers:read', 'customers:update', 'customers:archive',
  'sites:read', 'sites:update', 'sites:archive', 'sites:restore',
  'shifts:read', 'shifts:manage',
  'logbook:read', 'logbook:create',
  'planning:read', 'planning:manage', 'planning:publish',
  'planning:swaps:manage', 'planning:swaps:approve',
  'planning:covers:manage', 'planning:covers:approve',
  'planning:actuals:manage', 'planning:actuals:approve', 'planning:reports:read',
  'planning:exceptions:manage', 'planning:exceptions:approve',
  'keys:read', 'keys:manage',
  'employees:read', 'employees:update', 'employees:archive',
  'employees:restore', 'qualifications:manage', 'employees:absence:manage',
  'employees:absence:approve',
  'documents:read', 'documents:create', 'documents:update', 'documents:download',
  'documents:archive', 'documents:restore', 'documents:approve',
  'sop:read', 'sop:create', 'sop:update', 'sop:manage', 'sop:submit', 'sop:review',
  'sop:approve', 'sop:publish', 'sop:archive', 'sop:acknowledge', 'sop:assign',
  'handovers:read', 'handovers:create', 'handover:create', 'handovers:update', 'handovers:confirm',
  'handovers:tasks', 'handovers:manage',
  'alarm:read', 'alarm:manage', 'alarm:report', 'alarm:respond',
  'alarm:action:create', 'alarm:assign', 'alarm:notifications:read', 'alarm:escalation:manage',
  'emergency_plan:publish', 'emergency_contact:read', 'emergency_contact:manage',
  'patrol:read', 'patrol:create', 'patrol:manage', 'patrol:dashboard:read', 'patrol:analytics:read',
  'patrol:checkpoint:read', 'patrol:checkpoint:manage', 'patrol:route:read',
  'patrol:route:manage', 'patrol:round:read', 'patrol:round:perform',
  'patrol:round:start', 'patrol:round:complete', 'patrol:history:read',
  'patrol:scan-attempt:read', 'patrol:exception:read', 'patrol:exception:create',
  'patrol:audit'
]);

export const OWN_SCOPED_PERMISSION_CODES = new Set([
  'employees:read', 'logbook:read', 'keys:read',
  'documents:read', 'documents:download', 'patrol:round:read'
]);
