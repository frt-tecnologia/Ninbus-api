/**
 * API barrel — single import point for all service clients.
 *
 * Usage:
 *   import { companyService, deviceService } from '@/lib/api';
 */

export { categoryService } from './categories';
export { companyService } from './companies';
export { deploymentService } from './deployments';
export { deviceService } from './devices';
export { firmwareService } from './firmware';
export { ApiClientError, http } from './http';
export type { AddMemberInput, CompanyRole, Member, UpdateMemberInput } from './members';
export { memberService } from './members';
export type {
	ActivityLogEntry,
	AggregateBucket,
	AggregatedCategory,
	CompanyActivity,
	ConnectionsResponse,
	DailyOnlinePoint,
	HourlyBucket,
	PlatformStats,
	SessionBand,
} from './observability';
export { observabilityService } from './observability';
export type { CreateDesignationInput } from './users';
export { designationService, userService } from './users';
