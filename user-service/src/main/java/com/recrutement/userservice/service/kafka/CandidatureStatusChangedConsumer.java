package com.recrutement.userservice.service.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.event.CandidatureStatusChangedEvent;
import com.recrutement.userservice.repository.UserRepository;
import com.recrutement.userservice.service.EmailService;
import com.recrutement.userservice.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
@RequiredArgsConstructor
public class CandidatureStatusChangedConsumer {

    private final ObjectMapper objectMapper;
    private final NotificationService notificationService;
    private final UserRepository userRepository;
    private final EmailService emailService;

    @KafkaListener(
            topics = "candidature-status-changed-events",
            groupId = "user-service-group"
    )
    public void consumeStatusChangedEvent(String message) {
        try {
            CandidatureStatusChangedEvent event = objectMapper.readValue(
                    message,
                    CandidatureStatusChangedEvent.class
            );

            String offerLabel = StringUtils.hasText(event.getOffreTitle())
                    ? event.getOffreTitle().trim()
                    : "l’offre n°" + event.getOffreId();

            String title;
            String body;
            String status = event.getNewStatus() == null
                    ? ""
                    : event.getNewStatus().trim().toUpperCase();

            switch (status) {
                case "ACCEPTED", "ACCEPTEE", "ACCEPTE" -> {
                    title = "Candidature acceptée";
                    body = "Bonne nouvelle : votre candidature pour « "
                            + offerLabel
                            + " » a été acceptée.";
                }
                case "REJECTED", "REFUSED", "REFUSEE" -> {
                    title = "Candidature non retenue";
                    body = "Votre candidature pour « "
                            + offerLabel
                            + " » n’a pas été retenue. Merci pour votre intérêt.";
                }
                default -> {
                    title = "Mise à jour de votre candidature";
                    body = "Le statut de votre candidature pour « "
                            + offerLabel
                            + " » est passé à "
                            + event.getNewStatus()
                            + ".";
                }
            }

            notificationService.createNotification(
                    event.getCandidateId(),
                    title,
                    body,
                    "CANDIDATURE_STATUS_"
                            + event.getCandidatureId()
                            + "_"
                            + event.getNewStatus()
            );

            User candidate = userRepository.findById(event.getCandidateId()).orElse(null);
            if (candidate == null || !StringUtils.hasText(candidate.getEmail())) {
                return;
            }

            if ("ACCEPTED".equals(status)
                    || "ACCEPTEE".equals(status)
                    || "ACCEPTE".equals(status)) {
                emailService.sendCandidatureAccepted(
                        candidate.getEmail(),
                        candidate.getFirstName(),
                        offerLabel
                );
            } else if ("REJECTED".equals(status)
                    || "REFUSED".equals(status)
                    || "REFUSEE".equals(status)) {
                emailService.sendCandidatureRejected(
                        candidate.getEmail(),
                        candidate.getFirstName(),
                        offerLabel
                );
            }

        } catch (Exception e) {
            throw new IllegalStateException(
                    "Échec du traitement de CANDIDATURE_STATUS_CHANGED",
                    e
            );
        }
    }
}
