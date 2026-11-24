package com.recrutement.userservice.service.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.event.CandidatureCreatedEvent;
import com.recrutement.userservice.repository.UserRepository;
import com.recrutement.userservice.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class CandidatureNotificationConsumer {

    private final ObjectMapper objectMapper;
    private final NotificationService notificationService;
    private final UserRepository userRepository;

    @KafkaListener(
            topics = "candidature-created-events",
            groupId = "user-service-group"
    )
    public void consumeCandidatureCreatedEvent(String message) {
        try {
            CandidatureCreatedEvent event = objectMapper.readValue(
                    message,
                    CandidatureCreatedEvent.class
            );

            String who = personName(event.getCandidateId());
            String offer = offerName(event.getOfferTitle());
            String sentence = who + " a postulé à « " + offer + " ».";

            notificationService.createNotification(
                    event.getRecruiterId(),
                    "Nouvelle candidature",
                    sentence,
                    "CANDIDATURE_CREATED_" + event.getCandidatureId()
            );

            for (User admin : userRepository.findByRole(Role.ADMIN)) {
                if (admin.getId() == null
                        || admin.getId().equals(event.getRecruiterId())
                        || !Boolean.TRUE.equals(admin.getEnabled())) {
                    continue;
                }
                notificationService.createNotification(
                        admin.getId(),
                        "Nouvelle candidature",
                        sentence,
                        "CANDIDATURE_CREATED:" + event.getCandidatureId() + ":" + admin.getId()
                );
            }

        } catch (Exception e) {
            throw new IllegalStateException(
                    "Échec du traitement de CANDIDATURE_CREATED",
                    e
            );
        }
    }

    private String personName(Long userId) {
        if (userId == null) return "Un candidat";
        return userRepository.findById(userId)
                .map(user -> {
                    String name = ((user.getFirstName() == null ? "" : user.getFirstName())
                            + " "
                            + (user.getLastName() == null ? "" : user.getLastName())).trim();
                    return name.isBlank() ? "Un candidat" : name;
                })
                .orElse("Un candidat");
    }

    private static String offerName(String title) {
        if (title == null || title.isBlank()) return "une offre";
        return title.trim();
    }
}