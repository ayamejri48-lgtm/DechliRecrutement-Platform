package com.recrutement.offreservice.service;

import com.recrutement.offreservice.entity.Offre;
import com.recrutement.offreservice.repository.OffreRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Rappels J-2 et jour J pour les offres publiées à échéance.
 * Insertion directe dans user_db.notifications (idempotente via event_key).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class OffreDeadlineReminderJob {

    private final OffreRepository offreRepository;
    private final JdbcTemplate jdbcTemplate;

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        sendDeadlineReminders();
    }

    @Scheduled(cron = "0 15 8 * * *")
    public void sendDeadlineReminders() {
        LocalDate today = LocalDate.now();
        remind(today.plusDays(2), "OFFRE_DEADLINE_J2", "Rappel : clôture dans 2 jours",
                "L’offre « %s » se clôture dans 2 jours.");
        remind(today, "OFFRE_DEADLINE_J0", "Clôture aujourd’hui",
                "L’offre « %s » arrive à échéance aujourd’hui.");
    }

    private void remind(LocalDate day, String keyPrefix, String title, String messageTpl) {
        List<Offre> offres = offreRepository.findPublishedWithDeadlineOn(day);
        for (Offre offre : offres) {
            String eventKey = keyPrefix + ":" + offre.getId() + ":" + day;
            boolean inserted = insertNotification(
                    offre.getRecruiterId(),
                    title,
                    String.format(messageTpl, offre.getTitle()),
                    eventKey
            );
            if (inserted) {
                log.info("deadline_reminder key={} recruiter={}", eventKey, offre.getRecruiterId());
            }
        }
    }

    private boolean insertNotification(
            Long recipientId,
            String title,
            String message,
            String eventKey) {
        try {
            Integer exists = jdbcTemplate.query(
                    "SELECT 1 FROM user_db.notifications WHERE event_key = ? LIMIT 1",
                    rs -> rs.next() ? 1 : 0,
                    eventKey
            );
            if (exists != null && exists == 1) {
                return false;
            }
            jdbcTemplate.update(
                    """
                    INSERT INTO user_db.notifications
                      (recipient_id, title, message, event_key, is_read, created_at)
                    VALUES (?, ?, ?, ?, 0, ?)
                    """,
                    recipientId,
                    title.length() > 255 ? title.substring(0, 255) : title,
                    message.length() > 1000 ? message.substring(0, 1000) : message,
                    eventKey.length() > 255 ? eventKey.substring(0, 255) : eventKey,
                    LocalDateTime.now()
            );
            return true;
        } catch (Exception ex) {
            log.warn("deadline_reminder_failed key={} err={}", eventKey, ex.getClass().getSimpleName());
            return false;
        }
    }
}
