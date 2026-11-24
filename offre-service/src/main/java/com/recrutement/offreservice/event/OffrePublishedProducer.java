package com.recrutement.offreservice.event;

import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class OffrePublishedProducer {

    private static final String TOPIC = "offre-published-events";

    private final KafkaTemplate<String, OffrePublishedEvent> kafkaTemplate;

    public void send(OffrePublishedEvent event) {
        kafkaTemplate.send(
                TOPIC,
                event.getOffreId().toString(),
                event
        );
    }
}
