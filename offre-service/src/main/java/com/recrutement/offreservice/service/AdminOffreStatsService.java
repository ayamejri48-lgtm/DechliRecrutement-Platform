package com.recrutement.offreservice.service;

import com.recrutement.offreservice.dto.AdminOffreStatsResponse;
import com.recrutement.offreservice.dto.AdminOffreStatsResponse.DayVolume;
import com.recrutement.offreservice.entity.MatchResultStatus;
import com.recrutement.offreservice.repository.CandidatureRepository;
import com.recrutement.offreservice.repository.MatchResultRepository;
import com.recrutement.offreservice.repository.OffreRepository;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class AdminOffreStatsService {

    private final OffreRepository offreRepository;
    private final CandidatureRepository candidatureRepository;
    private final MatchResultRepository matchResultRepository;

    public AdminOffreStatsService(
            OffreRepository offreRepository,
            CandidatureRepository candidatureRepository,
            MatchResultRepository matchResultRepository) {
        this.offreRepository = offreRepository;
        this.candidatureRepository = candidatureRepository;
        this.matchResultRepository = matchResultRepository;
    }

    @Transactional(readOnly = true)
    public AdminOffreStatsResponse stats(String role) {
        if (!"ADMIN".equals(role)) {
            throw new AccessDeniedException("Accès réservé aux administrateurs");
        }

        Map<String, Long> offres = names(offreRepository.countByStatus());
        Map<String, Long> candidatures = names(candidatureRepository.countByStatus());

        LocalDate today = LocalDate.now();
        LocalDate start = today.minusDays(6);
        Map<LocalDate, Long> perDay = new HashMap<>();
        for (LocalDateTime applied : candidatureRepository.findAppliedAtSince(start.atStartOfDay())) {
            if (applied == null) {
                continue;
            }
            LocalDate day = applied.toLocalDate();
            if (day.isBefore(start) || day.isAfter(today)) {
                continue;
            }
            perDay.merge(day, 1L, Long::sum);
        }
        List<DayVolume> volume = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            LocalDate day = start.plusDays(i);
            volume.add(new DayVolume(day.toString(), perDay.getOrDefault(day, 0L)));
        }

        long low = 0;
        long medium = 0;
        long high = 0;
        long unavailable = 0;
        long pending = 0;
        long failed = 0;
        for (Object[] row : matchResultRepository.countByStatusAndBand()) {
            String status = row[0] == null ? "" : String.valueOf(row[0]);
            String band = row[1] == null ? "" : String.valueOf(row[1]).toLowerCase(Locale.ROOT);
            long count = ((Number) row[2]).longValue();
            if (MatchResultStatus.PENDING.name().equals(status)) {
                pending += count;
            } else if (MatchResultStatus.FAILED.name().equals(status)) {
                failed += count;
            } else if (MatchResultStatus.DONE.name().equals(status)) {
                switch (band) {
                    case "low" -> low += count;
                    case "medium" -> medium += count;
                    case "high" -> high += count;
                    default -> unavailable += count;
                }
            }
        }

        long samples = 0;
        double seconds = 0;
        for (Object[] span : candidatureRepository.findDecisionSpans()) {
            if (!(span[0] instanceof LocalDateTime applied) || !(span[1] instanceof LocalDateTime decided)) {
                continue;
            }
            if (decided.isBefore(applied)) {
                continue;
            }
            seconds += Duration.between(applied, decided).getSeconds();
            samples++;
        }
        Double delayDays = samples == 0
                ? null
                : Math.round(((seconds / samples) / 86400.0) * 10.0) / 10.0;

        return new AdminOffreStatsResponse(
                offreRepository.count(),
                offres.getOrDefault("PUBLISHED", 0L),
                offres.getOrDefault("DRAFT", 0L),
                offres.getOrDefault("CLOSED", 0L),
                candidatureRepository.count(),
                candidatures.getOrDefault("PENDING", 0L),
                candidatures.getOrDefault("UNDER_REVIEW", 0L),
                candidatures.getOrDefault("ACCEPTED", 0L),
                candidatures.getOrDefault("REJECTED", 0L),
                candidatures.getOrDefault("WITHDRAWN", 0L),
                volume,
                low,
                medium,
                high,
                unavailable,
                pending,
                failed,
                candidatureRepository.countWithoutMatch(),
                delayDays,
                samples,
                offreRepository.findDraftIdsWithoutSkills().size(),
                offreRepository.countPublishedPastDeadline(today),
                offreRepository.countPublishedWithoutCandidature(),
                candidatureRepository.countStaleOpen(LocalDateTime.now().minusDays(7)),
                offreRepository.findPublishedIds()
        );
    }

    private static Map<String, Long> names(List<Object[]> rows) {
        Map<String, Long> out = new HashMap<>();
        for (Object[] row : rows) {
            if (row[0] == null) {
                continue;
            }
            out.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
        }
        return out;
    }
}
