package com.recrutement.userservice.service.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.event.OffrePublishedEvent;
import com.recrutement.userservice.repository.UserRepository;
import com.recrutement.userservice.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class OffrePublishedNotificationConsumer {

    private final ObjectMapper objectMapper;
    private final NotificationService notificationService;
    private final UserRepository userRepository;

    @KafkaListener(
            topics = "offre-published-events",
            groupId = "user-service-group"
    )
    public void consume(String message) {
        try {
            OffrePublishedEvent event = objectMapper.readValue(
                    message,
                    OffrePublishedEvent.class
            );

            String offerName = event.getTitle() != null && !event.getTitle().isBlank()
                    ? event.getTitle().trim()
                    : "Offre sans titre";
            String title = "Nouvelle offre publiée";
            String body = "Une nouvelle offre est disponible : " + offerName + ".";

            List<User> recipients = new ArrayList<>();
            recipients.addAll(userRepository.findByRole(Role.CANDIDATE));
            recipients.addAll(userRepository.findByRole(Role.ADMIN));

            for (User recipient : recipients) {
                notificationService.createNotification(
                        recipient.getId(),
                        title,
                        body,
                        "OFFRE_PUBLISHED:" + event.getOffreId() + ":" + recipient.getId()
                );
            }
        } catch (Exception e) {
            throw new IllegalStateException(
                    "Échec du traitement de OFFRE_PUBLISHED",
                    e
            );
        }
    }
}
