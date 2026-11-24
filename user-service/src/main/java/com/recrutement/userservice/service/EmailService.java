package com.recrutement.userservice.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final JavaMailSender mailSender;

    @Value("${spring.mail.username:}")
    private String fromAddress;

    public EmailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public void sendCandidatureAccepted(String toEmail, String firstName, String offreTitle) {
        String offer = displayOffer(offreTitle);
        send(
                toEmail,
                "Votre candidature a été retenue — " + offer,
                greeting(firstName) + "\n\n"
                        + "Nous avons le plaisir de vous informer que votre candidature "
                        + "pour le poste « " + offer + " » a été acceptée.\n\n"
                        + "Nous vous remercions sincèrement pour l’intérêt que vous portez "
                        + "à notre organisation, ainsi que pour le temps et l’engagement "
                        + "que vous avez consacrés à votre parcours de recrutement.\n\n"
                        + "Notre équipe reviendra vers vous dans les plus brefs délais "
                        + "afin de vous préciser les prochaines étapes.\n\n"
                        + "En vous souhaitant encore une fois toutes nos félicitations,\n\n"
                        + "Cordialement,\n"
                        + "L’équipe DechliRecrutement\n"
        );
    }

    public void sendCandidatureRejected(String toEmail, String firstName, String offreTitle) {
        String offer = displayOffer(offreTitle);
        send(
                toEmail,
                "Suite à votre candidature — " + offer,
                greeting(firstName) + "\n\n"
                        + "Nous vous remercions vivement pour l’intérêt que vous avez "
                        + "porté au poste « " + offer + " », ainsi que pour le temps "
                        + "que vous avez consacré à votre candidature.\n\n"
                        + "Après un examen attentif de votre dossier, nous sommes au regret "
                        + "de vous informer que votre candidature n’a pas été retenue "
                        + "pour ce poste.\n\n"
                        + "Cette décision ne remet en rien en cause la qualité de votre "
                        + "parcours. Nous vous encourageons à consulter nos prochaines "
                        + "opportunités et à postuler à nouveau dès qu’un poste "
                        + "correspondra à votre profil.\n\n"
                        + "Nous vous souhaitons plein succès dans la suite de vos projets "
                        + "professionnels.\n\n"
                        + "Cordialement,\n"
                        + "L’équipe DechliRecrutement\n"
        );
    }

    private void send(String toEmail, String subject, String body) {
        if (!StringUtils.hasText(toEmail)) {
            log.warn("email_skipped reason=no_recipient");
            return;
        }
        if (!StringUtils.hasText(fromAddress)) {
            log.info("email_skipped reason=smtp_not_configured");
            return;
        }
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(fromAddress.trim());
            message.setTo(toEmail.trim());
            message.setSubject(subject);
            message.setText(body);
            mailSender.send(message);
            log.info("email_ok to={} subject={}", toEmail, subject);
        } catch (Exception ex) {
            // Ne pas faire échouer le traitement Kafka si SMTP est indisponible.
            log.warn("email_failed to={} err={}", toEmail, ex.getClass().getSimpleName());
        }
    }

    private static String greeting(String firstName) {
        if (!StringUtils.hasText(firstName)) {
            return "Bonjour,";
        }
        return "Bonjour " + firstName.trim() + ",";
    }

    private static String displayOffer(String offreTitle) {
        if (!StringUtils.hasText(offreTitle)) {
            return "l’offre concernée";
        }
        return offreTitle.trim();
    }
}
