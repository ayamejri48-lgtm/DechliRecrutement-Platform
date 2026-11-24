package com.recrutement.authservice.service.kafka;

import com.recrutement.authservice.repository.OutboxEventRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.ExecutionException;

@Service
@RequiredArgsConstructor
public class OutboxPublisherService {

    private final OutboxEventRepository outboxEventRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    @Scheduled(fixedDelay = 5000)
    @Transactional
    public void publishPendingEvents() {

        var events = outboxEventRepository
                .findTop50ByPublishedFalseOrderByCreatedAtAsc();

        for (var event : events) {
            try {
                kafkaTemplate.send(
                        event.getTopic(),
                        event.getEventKey(),
                        event.getPayload()
                ).get(10, TimeUnit.SECONDS);

                event.setPublished(true);
                outboxEventRepository.save(event);

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(
                        "Publication Kafka interrompue", e
                );

            } catch (ExecutionException | TimeoutException e) {
                throw new IllegalStateException(
                        "Échec de publication Kafka", e
                );
            }
        }
    }
}
