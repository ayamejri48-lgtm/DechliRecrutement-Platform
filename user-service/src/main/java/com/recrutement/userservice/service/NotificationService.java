package com.recrutement.userservice.service;

import com.recrutement.userservice.entity.Notification;
import com.recrutement.userservice.repository.NotificationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class NotificationService {

    private final NotificationRepository notificationRepository;

    @Transactional
    public void createNotification(
            Long recipientId,
            String title,
            String message,
            String eventKey) {

        if (notificationRepository.existsByEventKey(eventKey)) {
            return;
        }

        Notification notification = Notification.builder()
                .recipientId(recipientId)
                .title(title)
                .message(message)
                .eventKey(eventKey)
                .build();

        notificationRepository.save(notification);
    }

    @Transactional(readOnly = true)
    public List<Notification> getMyNotifications(Long recipientId) {
        return notificationRepository
                .findByRecipientIdOrderByCreatedAtDesc(recipientId);
    }

    @Transactional(readOnly = true)
    public long countUnreadNotifications(Long recipientId) {
        return notificationRepository
                .countByRecipientIdAndReadFalse(recipientId);
    }

    @Transactional
    public void markAsRead(Long notificationId, Long recipientId) {
        Notification notification = notificationRepository
                .findByIdAndRecipientId(notificationId, recipientId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Notification not found"
                ));

        notification.setRead(true);
    }
}