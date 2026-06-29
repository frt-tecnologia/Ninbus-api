/**
 * API barrel — single import point for all service clients.
 *
 * Usage:
 *   import { companyService, deviceService } from '@/lib/api';
 */
export { ApiClientError, http } from './http';
export { companyService } from './companies';
export { deviceService } from './devices';
export { memberService } from './members';
export type { AddMemberInput, UpdateMemberInput, CompanyRole, Member } from './members';
export { designationService, userService } from './users';
export type { CreateDesignationInput } from './users';
export { deploymentService } from './deployments';
