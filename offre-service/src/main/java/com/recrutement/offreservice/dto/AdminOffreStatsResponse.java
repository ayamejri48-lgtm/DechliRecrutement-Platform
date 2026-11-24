package com.recrutement.offreservice.dto;

import java.util.List;

public record AdminOffreStatsResponse(
        long offres,
        long published,
        long draft,
        long closed,
        long candidatures,
        long pending,
        long underReview,
        long accepted,
        long rejected,
        long withdrawn,
        List<DayVolume> volume7d,
        long matchLow,
        long matchMedium,
        long matchHigh,
        long matchUnavailable,
        long matchPending,
        long matchFailed,
        long matchAbsent,
        Double decisionDelayDays,
        long decisionSamples,
        long draftsWithoutSkills,
        long publishedPastDeadline,
        long publishedWithoutCandidature,
        long staleOpen,
        List<Long> publishedOffreIds
) {
    public record DayVolume(String date, long count) {
    }
}
