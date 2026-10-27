// src/lib/supabase.ts - Supabase client with real telemetry & fallback
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://phtyjpwhtvmtqkzidxjp.supabase.co';
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_LuAnmUa9R4Wcll7Uz47CsQ_vb6D7I9g';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface SeatAllocation {
  total_seats: number;
  claimed_seats: number;
  available_seats: number;
  max_cap: number;
}

export interface RoadmapProposal {
  id: string;
  title: string;
  category: string;
  phase: string;
  votes_count: number;
}

// Fallback baseline: 1,000 initial seats, 5 claimed, 995 open
const FALLBACK_SEATS: SeatAllocation = {
  total_seats: 1000,
  claimed_seats: 5,
  available_seats: 995,
  max_cap: 5000
};

const FALLBACK_PROPOSALS: RoadmapProposal[] = [
  { id: 'editor-support', title: 'Better editor support', category: 'Ecosystem', phase: 'Phase 5', votes_count: 1240 },
  { id: 'team-collab', title: 'Team collaboration', category: 'Ecosystem', phase: 'Phase 5', votes_count: 892 },
  { id: 'advanced-analytics', title: 'Advanced analytics', category: 'Beyond', phase: 'Phase 5+', votes_count: 437 },
  { id: 'sustainer-gate', title: 'Sustainer Gate (v1)', category: 'Community', phase: 'Phase 4', votes_count: 612 },
  { id: 'points-system', title: 'Monthly Points System', category: 'Community', phase: 'Phase 4', votes_count: 538 },
  { id: 'expanded-integrations', title: 'Expanded Integrations', category: 'Beyond', phase: 'Phase 5', votes_count: 310 }
];

export async function getSeatAllocation(): Promise<SeatAllocation> {
  try {
    const { data, error } = await supabase
      .from('seat_pool')
      .select('total_seats, claimed_seats, max_cap')
      .eq('id', 1)
      .maybeSingle();

    if (error || !data) {
      return FALLBACK_SEATS;
    }

    const available = Math.max(0, data.total_seats - data.claimed_seats);
    return {
      total_seats: data.total_seats,
      claimed_seats: data.claimed_seats,
      available_seats: available,
      max_cap: data.max_cap
    };
  } catch {
    return FALLBACK_SEATS;
  }
}

export async function getRoadmapProposals(): Promise<RoadmapProposal[]> {
  try {
    const { data, error } = await supabase
      .from('roadmap_proposals')
      .select('*')
      .order('votes_count', { ascending: false });

    if (error || !data || data.length === 0) {
      return FALLBACK_PROPOSALS;
    }

    return data as RoadmapProposal[];
  } catch {
    return FALLBACK_PROPOSALS;
  }
}

export async function upvoteProposal(proposalId: string, voterId: string, isVerified = false) {
  try {
    // Try RPC function first
    const { data: rpcData, error: rpcError } = await supabase.rpc('upvote_proposal', {
      p_proposal_id: proposalId,
      p_voter_id: voterId,
      p_is_verified: isVerified
    });

    if (!rpcError && rpcData) {
      return rpcData;
    }

    // Direct table fallback
    const { error: insertError } = await supabase.from('roadmap_votes').insert({
      proposal_id: proposalId,
      voter_id: voterId,
      is_verified: isVerified
    });

    if (insertError) {
      return { success: false, message: 'Already upvoted or connection error' };
    }

    return { success: true };
  } catch {
    return { success: false, message: 'Offline mode active' };
  }
}
